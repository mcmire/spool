import { spawn, type ChildProcess } from "node:child_process";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node.js";
import type {
  InitializeParams,
  InitializeResult,
  DidOpenTextDocumentParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  PublishDiagnosticsParams,
} from "vscode-languageserver-protocol";
import type { LanguageServerConfig, VirtualDocument, SuperLSConfig } from "./types.js";
import { getServerConfig, normalizeLanguage } from "./config.js";

const REQUEST_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Manages a single child language server process.
 */
class ChildServer {
  private process: ChildProcess | undefined;
  private connection: MessageConnection | undefined;
  private initialized = false;
  private initializePromise: Promise<void> | undefined;

  constructor(
    private readonly language: string,
    private readonly serverConfig: LanguageServerConfig,
    private readonly workspaceRoot: string | undefined,
    private readonly onDiagnostics: (params: PublishDiagnosticsParams) => void,
  ) {}

  /**
   * Ensure the child server is spawned and initialized.
   */
  async ensureRunning(): Promise<MessageConnection> {
    if (this.connection && this.initialized) {
      return this.connection;
    }

    if (this.initializePromise) {
      await this.initializePromise;
      return this.connection!;
    }

    this.initializePromise = this.spawnAndInitialize();
    await this.initializePromise;
    return this.connection!;
  }

  private async spawnAndInitialize(): Promise<void> {
    const { command, args = [], env } = this.serverConfig;

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });

    this.process.on("exit", (code, signal) => {
      console.error(
        `[super-ls] Child server for ${this.language} exited (code=${code}, signal=${signal})`,
      );
      this.connection = undefined;
      this.initialized = false;
      this.initializePromise = undefined;
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      console.error(`[super-ls][${this.language}] ${data.toString()}`);
    });

    this.connection = createMessageConnection(
      new StreamMessageReader(this.process.stdout!),
      new StreamMessageWriter(this.process.stdin!),
    );

    // Listen for diagnostics pushed from the child server
    this.connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: PublishDiagnosticsParams) => {
        this.onDiagnostics(params);
      },
    );

    this.connection.listen();

    const initParams: InitializeParams = {
      processId: process.pid,
      capabilities: {
        textDocument: {
          hover: { contentFormat: ["markdown", "plaintext"] },
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ["markdown", "plaintext"],
            },
          },
          definition: {},
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: { valueSet: [] },
            },
          },
          publishDiagnostics: {},
        },
      },
      rootUri: this.workspaceRoot ? `file://${this.workspaceRoot}` : null,
      workspaceFolders: this.workspaceRoot
        ? [{ uri: `file://${this.workspaceRoot}`, name: "workspace" }]
        : null,
    };

    await withTimeout(
      this.connection.sendRequest("initialize", initParams) as Promise<InitializeResult>,
      REQUEST_TIMEOUT_MS,
    );

    this.connection.sendNotification("initialized", {});
    this.initialized = true;
  }

  async sendDidOpen(params: DidOpenTextDocumentParams): Promise<void> {
    const conn = await this.ensureRunning();
    conn.sendNotification("textDocument/didOpen", params);
  }

  async sendDidChange(params: DidChangeTextDocumentParams): Promise<void> {
    const conn = await this.ensureRunning();
    conn.sendNotification("textDocument/didChange", params);
  }

  async sendDidClose(params: DidCloseTextDocumentParams): Promise<void> {
    const conn = await this.ensureRunning();
    conn.sendNotification("textDocument/didClose", params);
  }

  async sendRequest<T>(method: string, params: unknown): Promise<T> {
    const conn = await this.ensureRunning();
    return withTimeout(conn.sendRequest(method, params) as Promise<T>, REQUEST_TIMEOUT_MS);
  }

  isRunning(): boolean {
    return this.initialized && this.connection !== undefined;
  }

  /**
   * Gracefully shut down the child server.
   */
  async shutdown(): Promise<void> {
    if (!this.connection || !this.process) {
      return;
    }

    try {
      await withTimeout(
        this.connection.sendRequest("shutdown") as Promise<void>,
        5_000,
      );
      this.connection.sendNotification("exit");
    } catch {
      // Force kill if graceful shutdown fails
      this.process.kill("SIGKILL");
    }

    this.connection.dispose();
    this.connection = undefined;
    this.initialized = false;
    this.initializePromise = undefined;
  }
}

/**
 * Manages child language server instances — one per language.
 */
export class ChildServerManager {
  private servers = new Map<string, ChildServer>();
  /** Documents that have been opened on each child server, for crash recovery */
  private openDocuments = new Map<string, Map<string, VirtualDocument>>();

  constructor(
    private readonly config: SuperLSConfig,
    private readonly workspaceRoot: string | undefined,
    private readonly onDiagnostics: (params: PublishDiagnosticsParams) => void,
  ) {}

  /**
   * Get or create a child server for a language.
   * Returns undefined if no server is configured for this language.
   */
  private getOrCreate(language: string): ChildServer | undefined {
    const normalized = normalizeLanguage(language);

    if (this.servers.has(normalized)) {
      return this.servers.get(normalized)!;
    }

    const serverConfig = getServerConfig(this.config, language);
    if (!serverConfig) {
      return undefined;
    }

    const server = new ChildServer(
      normalized,
      serverConfig,
      this.workspaceRoot,
      this.onDiagnostics,
    );

    this.servers.set(normalized, server);
    this.openDocuments.set(normalized, new Map());
    return server;
  }

  async didOpen(doc: VirtualDocument): Promise<void> {
    const server = this.getOrCreate(doc.language);
    if (!server) {
      return;
    }

    const normalized = normalizeLanguage(doc.language);
    this.openDocuments.get(normalized)?.set(doc.uri, doc);

    await server.sendDidOpen({
      textDocument: {
        uri: doc.uri,
        languageId: normalized,
        version: doc.version,
        text: doc.content,
      },
    });
  }

  async didChange(doc: VirtualDocument): Promise<void> {
    const server = this.getOrCreate(doc.language);
    if (!server) {
      return;
    }

    const normalized = normalizeLanguage(doc.language);
    this.openDocuments.get(normalized)?.set(doc.uri, doc);

    await server.sendDidChange({
      textDocument: {
        uri: doc.uri,
        version: doc.version,
      },
      contentChanges: [{ text: doc.content }],
    });
  }

  async didClose(doc: VirtualDocument): Promise<void> {
    const server = this.getOrCreate(doc.language);
    if (!server) {
      return;
    }

    const normalized = normalizeLanguage(doc.language);
    this.openDocuments.get(normalized)?.delete(doc.uri);

    await server.sendDidClose({
      textDocument: { uri: doc.uri },
    });
  }

  /**
   * Send an LSP request to the appropriate child server for a virtual document.
   */
  async sendRequest<T>(language: string, method: string, params: unknown): Promise<T | undefined> {
    const server = this.getOrCreate(language);
    if (!server) {
      return undefined;
    }

    try {
      return await server.sendRequest<T>(method, params);
    } catch (error) {
      console.error(`[super-ls] Request ${method} to ${language} server failed:`, error);
      return undefined;
    }
  }

  /**
   * Shut down all child servers gracefully.
   */
  async shutdownAll(): Promise<void> {
    const shutdowns = Array.from(this.servers.values()).map((server) =>
      server.shutdown().catch((err) => {
        console.error("[super-ls] Error shutting down child server:", err);
      }),
    );

    await Promise.all(shutdowns);
    this.servers.clear();
    this.openDocuments.clear();
  }
}
