import type {
  Hover,
  CompletionItem,
  CompletionList,
  Location,
  LocationLink,
  CodeAction,
  Command,
  Diagnostic,
  PublishDiagnosticsParams,
  HoverParams,
  CompletionParams,
  DefinitionParams,
  CodeActionParams,
  Range,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver-protocol";
import type { CodeBlock, VirtualDocument, SuperLSConfig } from "./types.js";
import { parseCodeBlocks } from "./markdown-parser.js";
import { VirtualDocumentManager } from "./virtual-document.js";
import { ChildServerManager } from "./child-server.js";
import {
  findCodeBlockAtPosition,
  toVirtualPosition,
  toMarkdownPosition,
  toMarkdownRange,
  toVirtualRange,
} from "./position-map.js";

/**
 * Coordinates Markdown parsing, virtual documents, child servers,
 * and feature proxying for the super language server.
 */
export class DocumentManager {
  private virtualDocs: VirtualDocumentManager;
  private childServers: ChildServerManager;
  /** Parsed code blocks per parent document URI */
  private codeBlocks = new Map<string, CodeBlock[]>();
  private onPublishDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void;

  constructor(
    config: SuperLSConfig,
    workspaceRoot: string | undefined,
    onPublishDiagnostics: (uri: string, diagnostics: Diagnostic[]) => void,
  ) {
    this.onPublishDiagnostics = onPublishDiagnostics;
    this.virtualDocs = new VirtualDocumentManager();
    this.childServers = new ChildServerManager(
      config,
      workspaceRoot,
      (params: PublishDiagnosticsParams) => this.handleChildDiagnostics(params),
    );
  }

  // ─── Document Lifecycle ───────────────────────────────────────────

  async onDocumentOpen(uri: string, text: string): Promise<void> {
    const blocks = parseCodeBlocks(text);
    this.codeBlocks.set(uri, blocks);

    const diff = this.virtualDocs.syncCodeBlocks(uri, blocks);

    for (const doc of diff.opened) {
      await this.childServers.didOpen(doc);
    }
  }

  async onDocumentChange(uri: string, text: string): Promise<void> {
    const blocks = parseCodeBlocks(text);
    this.codeBlocks.set(uri, blocks);

    const diff = this.virtualDocs.syncCodeBlocks(uri, blocks);

    for (const doc of diff.opened) {
      await this.childServers.didOpen(doc);
    }
    for (const doc of diff.changed) {
      await this.childServers.didChange(doc);
    }
    for (const doc of diff.closed) {
      await this.childServers.didClose(doc);
    }
  }

  async onDocumentClose(uri: string): Promise<void> {
    this.codeBlocks.delete(uri);

    const closed = this.virtualDocs.closeAll(uri);
    for (const doc of closed) {
      await this.childServers.didClose(doc);
    }
  }

  // ─── Feature Proxying ─────────────────────────────────────────────

  async onHover(params: HoverParams): Promise<Hover | null> {
    const { block, virtualDoc } = this.resolvePosition(params.textDocument.uri, params.position);
    if (!block || !virtualDoc) {
      return null;
    }

    const virtualPosition = toVirtualPosition(block, params.position);
    const result = await this.childServers.sendRequest<Hover>(
      block.language,
      "textDocument/hover",
      {
        textDocument: { uri: virtualDoc.uri },
        position: virtualPosition,
      },
    );

    if (!result) {
      return null;
    }

    // Translate range back to Markdown coordinates
    if (result.range) {
      result.range = toMarkdownRange(block, result.range);
    }

    return result;
  }

  async onCompletion(
    params: CompletionParams,
  ): Promise<CompletionItem[] | CompletionList | null> {
    const { block, virtualDoc } = this.resolvePosition(params.textDocument.uri, params.position);
    if (!block || !virtualDoc) {
      return null;
    }

    const virtualPosition = toVirtualPosition(block, params.position);
    const result = await this.childServers.sendRequest<CompletionItem[] | CompletionList>(
      block.language,
      "textDocument/completion",
      {
        textDocument: { uri: virtualDoc.uri },
        position: virtualPosition,
        context: params.context,
      },
    );

    if (!result) {
      return null;
    }

    const items = Array.isArray(result) ? result : result.items;
    for (const item of items) {
      this.translateCompletionItem(item, block);
    }

    return result;
  }

  async onDefinition(
    params: DefinitionParams,
  ): Promise<Location | Location[] | LocationLink[] | null> {
    const { block, virtualDoc } = this.resolvePosition(params.textDocument.uri, params.position);
    if (!block || !virtualDoc) {
      return null;
    }

    const virtualPosition = toVirtualPosition(block, params.position);
    const result = await this.childServers.sendRequest<Location | Location[] | LocationLink[]>(
      block.language,
      "textDocument/definition",
      {
        textDocument: { uri: virtualDoc.uri },
        position: virtualPosition,
      },
    );

    if (!result) {
      return null;
    }

    // Translate locations back
    if (Array.isArray(result)) {
      for (const item of result) {
        if ("targetUri" in item) {
          // LocationLink
          this.translateLocationLink(item, params.textDocument.uri);
        } else {
          // Location
          this.translateLocation(item, params.textDocument.uri);
        }
      }
    } else {
      // Single Location
      this.translateLocation(result, params.textDocument.uri);
    }

    return result;
  }

  async onCodeAction(
    params: CodeActionParams,
  ): Promise<(CodeAction | Command)[] | null> {
    const { block, virtualDoc } = this.resolvePosition(
      params.textDocument.uri,
      params.range.start,
    );
    if (!block || !virtualDoc) {
      return null;
    }

    const virtualRange = toVirtualRange(block, params.range);

    // Translate diagnostic ranges in the context
    const virtualDiagnostics = (params.context.diagnostics ?? []).map((d) => ({
      ...d,
      range: toVirtualRange(block, d.range),
    }));

    const result = await this.childServers.sendRequest<(CodeAction | Command)[]>(
      block.language,
      "textDocument/codeAction",
      {
        textDocument: { uri: virtualDoc.uri },
        range: virtualRange,
        context: {
          ...params.context,
          diagnostics: virtualDiagnostics,
        },
      },
    );

    if (!result) {
      return null;
    }

    // Translate response
    for (const item of result) {
      if ("edit" in item && item.edit) {
        this.translateWorkspaceEdit(item.edit, params.textDocument.uri);
      }
      if ("diagnostics" in item && item.diagnostics) {
        for (const diag of item.diagnostics) {
          diag.range = toMarkdownRange(block, diag.range);
        }
      }
    }

    return result;
  }

  // ─── Diagnostics ──────────────────────────────────────────────────

  private handleChildDiagnostics(params: PublishDiagnosticsParams): void {
    const virtualDoc = this.virtualDocs.findByVirtualUri(params.uri);
    if (!virtualDoc) {
      return;
    }

    const block = virtualDoc.codeBlock;
    const parentUri = virtualDoc.parentUri;

    // Translate diagnostic ranges to Markdown coordinates
    const translatedDiagnostics = params.diagnostics.map((d) => ({
      ...d,
      range: toMarkdownRange(block, d.range),
      source: d.source ? `${d.source} [${block.language}]` : block.language,
    }));

    // Merge diagnostics from all blocks in this parent document
    const allDocs = this.virtualDocs.getDocuments(parentUri);
    const allDiagnostics: Diagnostic[] = [...translatedDiagnostics];

    // For now, we just emit what this block produced.
    // A more complete implementation would accumulate per-block diagnostics.
    // We use a simple approach: replace diagnostics for this block's line range,
    // keeping diagnostics from other blocks.
    this.onPublishDiagnostics(parentUri, allDiagnostics);
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private resolvePosition(
    parentUri: string,
    position: { line: number; character: number },
  ): { block: CodeBlock | undefined; virtualDoc: VirtualDocument | undefined } {
    const blocks = this.codeBlocks.get(parentUri);
    if (!blocks) {
      return { block: undefined, virtualDoc: undefined };
    }

    const block = findCodeBlockAtPosition(blocks, position);
    if (!block) {
      return { block: undefined, virtualDoc: undefined };
    }

    const docs = this.virtualDocs.getDocuments(parentUri);
    const virtualDoc = docs.find((d) => d.codeBlock.index === block.index);

    return { block, virtualDoc };
  }

  private translateCompletionItem(item: CompletionItem, block: CodeBlock): void {
    if (item.textEdit) {
      if ("range" in item.textEdit) {
        item.textEdit.range = toMarkdownRange(block, item.textEdit.range);
      } else if ("insert" in item.textEdit && "replace" in item.textEdit) {
        item.textEdit.insert = toMarkdownRange(block, item.textEdit.insert);
        item.textEdit.replace = toMarkdownRange(block, item.textEdit.replace);
      }
    }
    if (item.additionalTextEdits) {
      for (const edit of item.additionalTextEdits) {
        edit.range = toMarkdownRange(block, edit.range);
      }
    }
  }

  private translateLocation(location: Location, parentUri: string): void {
    const virtualDoc = this.virtualDocs.findByVirtualUri(location.uri);
    if (virtualDoc) {
      location.uri = parentUri;
      location.range = toMarkdownRange(virtualDoc.codeBlock, location.range);
    }
    // If the URI doesn't match a virtual document, it's an external file — leave as-is
  }

  private translateLocationLink(link: LocationLink, parentUri: string): void {
    const virtualDoc = this.virtualDocs.findByVirtualUri(link.targetUri);
    if (virtualDoc) {
      link.targetUri = parentUri;
      link.targetRange = toMarkdownRange(virtualDoc.codeBlock, link.targetRange);
      link.targetSelectionRange = toMarkdownRange(virtualDoc.codeBlock, link.targetSelectionRange);
    }
    if (link.originSelectionRange) {
      // originSelectionRange is already in Markdown coordinates
    }
  }

  private translateWorkspaceEdit(edit: WorkspaceEdit, parentUri: string): void {
    if (edit.changes) {
      const newChanges: Record<string, TextEdit[]> = {};
      for (const [uri, edits] of Object.entries(edit.changes)) {
        const virtualDoc = this.virtualDocs.findByVirtualUri(uri);
        if (virtualDoc) {
          const translatedEdits = edits.map((e) => ({
            ...e,
            range: toMarkdownRange(virtualDoc.codeBlock, e.range),
          }));
          // Merge into parent URI
          const targetUri = parentUri;
          if (newChanges[targetUri]) {
            newChanges[targetUri].push(...translatedEdits);
          } else {
            newChanges[targetUri] = translatedEdits;
          }
        } else {
          newChanges[uri] = edits;
        }
      }
      edit.changes = newChanges;
    }

    if (edit.documentChanges) {
      for (const change of edit.documentChanges) {
        if ("textDocument" in change) {
          const virtualDoc = this.virtualDocs.findByVirtualUri(change.textDocument.uri);
          if (virtualDoc) {
            change.textDocument.uri = parentUri;
            for (const e of change.edits) {
              if ("range" in e) {
                e.range = toMarkdownRange(virtualDoc.codeBlock, e.range);
              }
            }
          }
        }
      }
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    await this.childServers.shutdownAll();
    this.virtualDocs.dispose();
    this.codeBlocks.clear();
  }
}
