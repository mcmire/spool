import type { Position, Range } from "vscode-languageserver-protocol";
import type { CodeBlock } from "./types.js";

/**
 * Find which code block (if any) contains the given Markdown position.
 * Position lines are 0-indexed (LSP convention).
 */
export function findCodeBlockAtPosition(
  blocks: CodeBlock[],
  position: Position,
): CodeBlock | undefined {
  return blocks.find(
    (block) => position.line >= block.startLine && position.line <= block.endLine,
  );
}

/**
 * Translate a Markdown position to a virtual document position.
 * Only adjusts the line; character stays the same since code blocks
 * start at column 0 in Markdown.
 */
export function toVirtualPosition(block: CodeBlock, mdPosition: Position): Position {
  return {
    line: mdPosition.line - block.startLine,
    character: mdPosition.character,
  };
}

/**
 * Translate a virtual document position back to a Markdown position.
 */
export function toMarkdownPosition(block: CodeBlock, virtualPosition: Position): Position {
  return {
    line: virtualPosition.line + block.startLine,
    character: virtualPosition.character,
  };
}

/**
 * Translate a Markdown range to a virtual document range.
 */
export function toVirtualRange(block: CodeBlock, mdRange: Range): Range {
  return {
    start: toVirtualPosition(block, mdRange.start),
    end: toVirtualPosition(block, mdRange.end),
  };
}

/**
 * Translate a virtual document range back to a Markdown range.
 */
export function toMarkdownRange(block: CodeBlock, virtualRange: Range): Range {
  return {
    start: toMarkdownPosition(block, virtualRange.start),
    end: toMarkdownPosition(block, virtualRange.end),
  };
}
