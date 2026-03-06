import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import type { Code } from "mdast";
import type { CodeBlock } from "./types.js";

/**
 * Parse a Markdown document and extract all fenced code blocks with language identifiers.
 * Returns CodeBlock[] with 0-indexed line numbers.
 *
 * Example: For a block at lines 3-6 in the Markdown (1-indexed, as mdast gives us):
 *   Line 3: ```typescript    ← opening fence
 *   Line 4: const x = 1;    ← content start (0-indexed: 3)
 *   Line 5: const y = 2;    ← content end   (0-indexed: 4)
 *   Line 6: ```              ← closing fence
 *
 * startLine = 3 (0-indexed line of first content line)
 * endLine = 4 (0-indexed line of last content line)
 */
export function parseCodeBlocks(markdownText: string): CodeBlock[] {
  const tree = fromMarkdown(markdownText);
  const blocks: CodeBlock[] = [];
  let index = 0;

  visit(tree, "code", (node: Code) => {
    if (!node.lang || !node.position) {
      return;
    }

    // mdast positions are 1-indexed
    const fenceOpenLine1 = node.position.start.line;
    const fenceCloseLine1 = node.position.end.line;

    // Convert to 0-indexed: content is between the fence lines
    const contentStartLine0 = fenceOpenLine1; // = (fenceOpenLine1 - 1) + 1
    const contentEndLine0 = fenceCloseLine1 - 2; // = (fenceCloseLine1 - 1) - 1

    blocks.push({
      language: node.lang,
      content: node.value,
      startLine: contentStartLine0,
      endLine: contentEndLine0,
      index,
    });

    index++;
  });

  return blocks;
}
