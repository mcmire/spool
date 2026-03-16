import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import type { InitializeResult, Diagnostic } from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Glob } from "bun";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot, loadConfig } from "../../config.ts";
import type { SpoolConfig } from "../../config.ts";
import { buildRegistries } from "../../registries.ts";
import type { PassageRegistry, PassageTemplateRegistry } from "../../registries.ts";
import { getSourceFileDiagnostics, getDocFileDiagnostics } from "./diagnostics.ts";
import packageJson from "../../../package.json" with { type: "json" };
const { version } = packageJson;

type SendDiagnostics = (params: { uri: string; diagnostics: Diagnostic[] }) => void;

export type ServerHandlers = {
  isSourceFile(filePath: string): boolean;
  isDocFile(filePath: string): boolean;
  getDiagnostics(filePath: string, content: string): Diagnostic[];
  validateDocument(uri: string, content: string): void;
};

export function createServerHandlers(
  projectRoot: string,
  config: SpoolConfig,
  registry: PassageRegistry,
  templateRegistry: PassageTemplateRegistry,
  sendDiagnostics: SendDiagnostics,
): ServerHandlers {
  function isSourceFile(filePath: string): boolean {
    const sourceDir = join(projectRoot, config.source.code);
    const docsDir = join(projectRoot, config.source.docs);
    if (!filePath.startsWith(sourceDir) || filePath.startsWith(docsDir)) {
      return false;
    }
    const relPath = relative(projectRoot, filePath);
    const excludeGlobs = (config.source.excludeFromCode ?? []).map((p) => new Glob(p));
    return !excludeGlobs.some((g) => g.match(relPath));
  }

  function isDocFile(filePath: string): boolean {
    const docsDir = join(projectRoot, config.source.docs);
    return filePath.startsWith(docsDir) && filePath.endsWith(".md");
  }

  function getDiagnostics(filePath: string, content: string): Diagnostic[] {
    if (isSourceFile(filePath)) {
      return getSourceFileDiagnostics(content);
    } else if (isDocFile(filePath)) {
      return getDocFileDiagnostics(content, registry, templateRegistry, config.source.code);
    } else {
      return [];
    }
  }

  function validateDocument(uri: string, content: string): void {
    let filePath: string;
    try {
      filePath = fileURLToPath(uri);
    } catch {
      return;
    }
    sendDiagnostics({ uri, diagnostics: getDiagnostics(filePath, content) });
  }

  return { isSourceFile, isDocFile, getDiagnostics, validateDocument };
}

export function startServer(): void {
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
  const documents = new TextDocuments(TextDocument);

  let projectRoot: string | null = null;
  let config: SpoolConfig | null = null;
  let registry: PassageRegistry = new Map();
  let templateRegistry: PassageTemplateRegistry = new Map();
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  let handlers: ServerHandlers | null = null;

  function getHandlers(): ServerHandlers | null {
    if (!projectRoot || !config) return null;
    if (!handlers) {
      handlers = createServerHandlers(projectRoot, config, registry, templateRegistry, (params) =>
        connection.sendDiagnostics(params),
      );
    }
    return handlers;
  }

  connection.onInitialize(async (_params): Promise<InitializeResult> => {
    projectRoot = findProjectRoot(process.cwd());
    config = await loadConfig(projectRoot);

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
      },
      serverInfo: { name: "spool", version },
    };
  });

  connection.onInitialized(async () => {
    await rebuildRegistries();
  });

  async function rebuildRegistries(): Promise<void> {
    if (!projectRoot || !config) {
      return;
    }
    try {
      const result = await buildRegistries(projectRoot, config);
      registry = result.registry;
      templateRegistry = result.templateRegistry;
      // Recreate handlers with updated registries
      handlers = createServerHandlers(projectRoot, config, registry, templateRegistry, (params) =>
        connection.sendDiagnostics(params),
      );
    } catch (err) {
      connection.console.error(`Failed to rebuild registry: ${err}`);
    }
  }

  function scheduleRebuild(): void {
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
    }
    rebuildTimer = setTimeout(async () => {
      await rebuildRegistries();
      for (const doc of documents.all()) {
        getHandlers()?.validateDocument(doc.uri, doc.getText());
      }
    }, 300);
  }

  documents.onDidChangeContent((change) => {
    const h = getHandlers();
    if (!h) return;
    let filePath: string;
    try {
      filePath = fileURLToPath(change.document.uri);
    } catch {
      return;
    }
    if (h.isSourceFile(filePath)) {
      scheduleRebuild();
    }
    h.validateDocument(change.document.uri, change.document.getText());
  });

  documents.onDidSave((change) => {
    const h = getHandlers();
    if (!h) return;
    let filePath: string;
    try {
      filePath = fileURLToPath(change.document.uri);
    } catch {
      return;
    }
    if (h.isSourceFile(filePath)) {
      scheduleRebuild();
    }
  });

  documents.listen(connection);
  connection.listen();
}
