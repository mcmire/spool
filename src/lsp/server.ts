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
import { findProjectRoot, loadConfig } from "../config.ts";
import type { SpoolConfig } from "../config.ts";
import { buildRegistries } from "../registries.ts";
import type { PassageRegistry, PassageTemplateRegistry } from "../registries.ts";
import { getSourceFileDiagnostics, getDocFileDiagnostics } from "./diagnostics.ts";
import { version } from "../../package.json" with { type: "json" };

export function startServer(): void {
  const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);
  const documents = new TextDocuments(TextDocument);

  let projectRoot: string | null = null;
  let config: SpoolConfig | null = null;
  let registry: PassageRegistry = new Map();
  let templateRegistry: PassageTemplateRegistry = new Map();
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

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
      // Re-validate all open documents after registry rebuild
      for (const doc of documents.all()) {
        validateDocument(doc);
      }
    }, 300);
  }

  function getFilePath(uri: string): string | null {
    try {
      return fileURLToPath(uri);
    } catch {
      return null;
    }
  }

  function isSourceFile(filePath: string): boolean {
    if (!projectRoot || !config) {
      return false;
    }
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
    if (!projectRoot || !config) {
      return false;
    }
    const docsDir = join(projectRoot, config.source.docs);
    return filePath.startsWith(docsDir) && filePath.endsWith(".md");
  }

  function getDiagnostics(filePath: string, content: string): Diagnostic[] {
    if (isSourceFile(filePath)) {
      return getSourceFileDiagnostics(content);
    } else if (isDocFile(filePath)) {
      return getDocFileDiagnostics(content, registry, templateRegistry);
    } else {
      return [];
    }
  }

  function validateDocument(document: TextDocument): void {
    const filePath = getFilePath(document.uri);
    if (!filePath || !projectRoot || !config) {
      return;
    }

    const diagnostics = getDiagnostics(filePath, document.getText());
    connection.sendDiagnostics({ uri: document.uri, diagnostics });
  }

  documents.onDidChangeContent((change) => {
    const filePath = getFilePath(change.document.uri);
    if (filePath && isSourceFile(filePath)) {
      scheduleRebuild();
    }
    validateDocument(change.document);
  });

  documents.onDidSave((change) => {
    const filePath = getFilePath(change.document.uri);
    if (filePath && isSourceFile(filePath)) {
      scheduleRebuild();
    }
  });

  documents.listen(connection);
  connection.listen();
}
