import type { Diagnostic } from "vscode-languageserver-protocol";

export interface CodeBlock {
  /** Language identifier from the fenced code block (e.g. "typescript", "python") */
  language: string;
  /** The code content (without the fence markers) */
  content: string;
  /** 0-indexed line number where the code content starts in the Markdown document */
  startLine: number;
  /** 0-indexed line number where the code content ends (exclusive) in the Markdown document */
  endLine: number;
  /** A stable identifier for diffing across edits (based on position) */
  index: number;
}

export interface VirtualDocument {
  /** URI of the virtual file on disk (file:// scheme) */
  uri: string;
  /** Absolute path to the temp file */
  filePath: string;
  /** Language identifier */
  language: string;
  /** Current content */
  content: string;
  /** Version counter for LSP sync */
  version: number;
  /** The parent Markdown document URI */
  parentUri: string;
  /** The code block this virtual document represents */
  codeBlock: CodeBlock;
}

export interface LanguageServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SuperLSConfig {
  servers: Record<string, LanguageServerConfig>;
}

export interface CodeBlockDiff {
  opened: VirtualDocument[];
  changed: VirtualDocument[];
  closed: VirtualDocument[];
}

export interface ChildDiagnostics {
  parentUri: string;
  diagnostics: Diagnostic[];
}
