import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  type InitializeParams,
  type InitializeResult,
} from "vscode-languageserver/node.js";
import { TextDocument } from "vscode-languageserver-textdocument";
import { DocumentManager } from "./document-manager.js";
import { loadConfig } from "./config.js";
import type { SuperLSConfig } from "./types.js";

const connection = createConnection();
const documents = new TextDocuments(TextDocument);

let documentManager: DocumentManager;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const workspaceRoot = params.workspaceFolders?.[0]?.uri
    ? new URL(params.workspaceFolders[0].uri).pathname
    : params.rootUri
      ? new URL(params.rootUri).pathname
      : undefined;

  const config = loadConfig(
    workspaceRoot,
    params.initializationOptions as Partial<SuperLSConfig> | undefined,
  );

  documentManager = new DocumentManager(config, workspaceRoot, (uri, diagnostics) => {
    connection.sendDiagnostics({ uri, diagnostics });
  });

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      hoverProvider: true,
      completionProvider: {
        triggerCharacters: [".", ":", "<", '"', "'", "/", "@", "#", " "],
        resolveProvider: false,
      },
      definitionProvider: true,
      codeActionProvider: true,
    },
  };
});

// ─── Document Lifecycle ───────────────────────────────────────────────

documents.onDidOpen((event) => {
  documentManager.onDocumentOpen(event.document.uri, event.document.getText());
});

documents.onDidChangeContent((event) => {
  documentManager.onDocumentChange(event.document.uri, event.document.getText());
});

documents.onDidClose((event) => {
  documentManager.onDocumentClose(event.document.uri);
});

// ─── Feature Handlers ─────────────────────────────────────────────────

connection.onHover((params) => {
  return documentManager.onHover(params);
});

connection.onCompletion((params) => {
  return documentManager.onCompletion(params);
});

connection.onDefinition((params) => {
  return documentManager.onDefinition(params);
});

connection.onCodeAction((params) => {
  return documentManager.onCodeAction(params);
});

// ─── Shutdown ─────────────────────────────────────────────────────────

connection.onShutdown(async () => {
  if (documentManager) {
    await documentManager.dispose();
  }
});

// ─── Start ────────────────────────────────────────────────────────────

documents.listen(connection);
connection.listen();
