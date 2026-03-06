import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";
import type { CodeBlock, VirtualDocument, CodeBlockDiff } from "./types.js";
import { getExtensionForLanguage } from "./config.js";

/**
 * Manages virtual documents (temp files on disk) for code blocks.
 * Each code block gets a temp file with the correct extension so child
 * language servers can work with real file:// URIs.
 */
export class VirtualDocumentManager {
  private shadowDir: string;
  /** Map from parent URI + block index → VirtualDocument */
  private documents = new Map<string, VirtualDocument>();

  constructor() {
    this.shadowDir = path.join(os.tmpdir(), `super-ls-${process.pid}`);
    fs.mkdirSync(this.shadowDir, { recursive: true });
  }

  private makeKey(parentUri: string, blockIndex: number): string {
    return `${parentUri}#${blockIndex}`;
  }

  private makeFilePath(parentUri: string, blockIndex: number, language: string): string {
    const ext = getExtensionForLanguage(language);
    // Use a hash of the parent URI to avoid path length issues
    const safeName = Buffer.from(parentUri).toString("base64url");
    return path.join(this.shadowDir, `${safeName}_block${blockIndex}${ext}`);
  }

  /**
   * Sync code blocks for a given parent document.
   * Diffs against previously known blocks and returns what changed.
   */
  syncCodeBlocks(parentUri: string, blocks: CodeBlock[]): CodeBlockDiff {
    const opened: VirtualDocument[] = [];
    const changed: VirtualDocument[] = [];
    const closed: VirtualDocument[] = [];

    const newKeys = new Set<string>();

    for (const block of blocks) {
      const key = this.makeKey(parentUri, block.index);
      newKeys.add(key);

      const existing = this.documents.get(key);

      if (!existing) {
        // New block — create virtual document
        const filePath = this.makeFilePath(parentUri, block.index, block.language);
        fs.writeFileSync(filePath, block.content, "utf-8");

        const doc: VirtualDocument = {
          uri: pathToFileURL(filePath).href,
          filePath,
          language: block.language,
          content: block.content,
          version: 1,
          parentUri,
          codeBlock: block,
        };

        this.documents.set(key, doc);
        opened.push(doc);
      } else if (existing.content !== block.content || existing.codeBlock.startLine !== block.startLine) {
        // Content or position changed — update
        existing.content = block.content;
        existing.version++;
        existing.codeBlock = block;
        fs.writeFileSync(existing.filePath, block.content, "utf-8");
        changed.push(existing);
      } else {
        // Update code block reference even if content unchanged (line numbers may shift)
        existing.codeBlock = block;
      }
    }

    // Find removed blocks
    for (const [key, doc] of this.documents) {
      if (!doc.parentUri.startsWith(parentUri)) {
        continue;
      }
      // Actually, key starts with parentUri#, so check properly
      if (key.startsWith(`${parentUri}#`) && !newKeys.has(key)) {
        closed.push(doc);
        this.documents.delete(key);
        try {
          fs.unlinkSync(doc.filePath);
        } catch {
          // File may already be gone
        }
      }
    }

    return { opened, changed, closed };
  }

  /**
   * Close all virtual documents for a parent URI.
   */
  closeAll(parentUri: string): VirtualDocument[] {
    const closed: VirtualDocument[] = [];

    for (const [key, doc] of this.documents) {
      if (key.startsWith(`${parentUri}#`)) {
        closed.push(doc);
        this.documents.delete(key);
        try {
          fs.unlinkSync(doc.filePath);
        } catch {
          // File may already be gone
        }
      }
    }

    return closed;
  }

  /**
   * Get all virtual documents for a parent URI.
   */
  getDocuments(parentUri: string): VirtualDocument[] {
    const result: VirtualDocument[] = [];
    for (const [key, doc] of this.documents) {
      if (key.startsWith(`${parentUri}#`)) {
        result.push(doc);
      }
    }
    return result;
  }

  /**
   * Find a virtual document by its virtual URI.
   */
  findByVirtualUri(virtualUri: string): VirtualDocument | undefined {
    for (const doc of this.documents.values()) {
      if (doc.uri === virtualUri) {
        return doc;
      }
    }
    return undefined;
  }

  /**
   * Clean up all temp files and the shadow directory.
   */
  dispose(): void {
    for (const doc of this.documents.values()) {
      try {
        fs.unlinkSync(doc.filePath);
      } catch {
        // Ignore
      }
    }
    this.documents.clear();

    try {
      fs.rmSync(this.shadowDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }
}
