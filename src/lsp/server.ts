import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  DiagnosticSeverity,
} from "vscode-languageserver/node.js";
import type {
  InitializeResult,
  Diagnostic,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findProjectRoot, loadConfig } from "../config.ts";
import type { SpoolConfig } from "../config.ts";
import { parseSourcePassages, parsePassageReferences, VALID_MODIFIERS } from "../parser.ts";
import { buildRegistries } from "../registries.ts";
import type { PassageRegistry, PassageTemplateRegistry } from "../registries.ts";

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
    const sourceDir = join(projectRoot, config.sourceCodeDir);
    const docsDir = join(projectRoot, config.sourceDocsDir);
    return filePath.startsWith(sourceDir) && !filePath.startsWith(docsDir);
  }

  function isDocFile(filePath: string): boolean {
    if (!projectRoot || !config) {
      return false;
    }
    const docsDir = join(projectRoot, config.sourceDocsDir);
    return filePath.startsWith(docsDir) && filePath.endsWith(".md");
  }

  function validateDocument(document: TextDocument): void {
    const filePath = getFilePath(document.uri);
    if (!filePath || !projectRoot || !config) {
      return;
    }

    const diagnostics: Diagnostic[] = [];
    const content = document.getText();

    if (isSourceFile(filePath)) {
      const { errors } = parseSourcePassages(content);
      for (const error of errors) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: error.line - 1, character: error.column - 1 },
            end: { line: error.line - 1, character: error.column - 1 },
          },
          message: error.message,
          source: "spool",
        });
      }
    } else if (isDocFile(filePath)) {
      const { refs } = parsePassageReferences(content);
      for (const ref of refs) {
        if (ref.modifier !== undefined && !VALID_MODIFIERS.has(ref.modifier)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: ref.line - 1, character: ref.column - 1 },
              end: {
                line: ref.line - 1,
                character: ref.column - 1 + ref.raw.length,
              },
            },
            message: `Unknown modifier: ${ref.modifier}`,
            source: "spool",
          });
          continue;
        }
        const key = `${ref.filePath}:${ref.passageName}`;
        const source = ref.modifier === "no-expand-nested" ? templateRegistry : registry;
        if (!source.has(key)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: {
              start: { line: ref.line - 1, character: ref.column - 1 },
              end: {
                line: ref.line - 1,
                character: ref.column - 1 + ref.raw.length,
              },
            },
            message: `Unknown reference: ${ref.raw}`,
            source: "spool",
          });
        }
      }
    }

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
