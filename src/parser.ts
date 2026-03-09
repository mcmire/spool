export type ParseError = {
  line: number;
  column: number;
  message: string;
};

export type DocReference = {
  filePath: string;
  blockName: string;
  line: number;
  column: number;
  raw: string;
};

const SOURCE_ANNOTATION_RE = /^(.*?)::spool::\s*<(\/?)([\w-]+)>\s*$/;
const DOC_REFERENCE_RE = /\{\{(.+?):([\w-]+)\}\}/g;

export function parseSourceBlocks(content: string): {
  blocks: Map<string, string>;
  errors: ParseError[];
} {
  const blocks = new Map<string, string>();
  const errors: ParseError[] = [];
  const stack: { name: string; lines: string[] }[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = SOURCE_ANNOTATION_RE.exec(line);

    if (match) {
      const isClosing = match[2] === "/";
      const blockName = match[3];

      if (isClosing) {
        if (stack.length === 0) {
          errors.push({
            line: i + 1,
            column: 1,
            message: `Closing block </${blockName}> without matching open`,
          });
        } else if (stack[stack.length - 1].name !== blockName) {
          errors.push({
            line: i + 1,
            column: 1,
            message: `Mismatched close: expected </${stack[stack.length - 1].name}>, got </${blockName}>`,
          });
        } else {
          const closed = stack.pop()!;
          blocks.set(blockName, closed.lines.join("\n"));
        }
      } else {
        if (blocks.has(blockName)) {
          errors.push({
            line: i + 1,
            column: 1,
            message: `Duplicate block name "${blockName}" in same file`,
          });
        }
        stack.push({ name: blockName, lines: [] });
      }
    } else {
      for (const frame of stack) {
        frame.lines.push(line);
      }
    }
  }

  for (const frame of stack) {
    errors.push({
      line: 1,
      column: 1,
      message: `Unclosed block <${frame.name}>`,
    });
  }

  return { blocks, errors };
}

export function parseDocReferences(content: string): {
  refs: DocReference[];
  errors: ParseError[];
} {
  const refs: DocReference[] = [];
  const errors: ParseError[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    let match: RegExpExecArray | null;
    DOC_REFERENCE_RE.lastIndex = 0;
    while ((match = DOC_REFERENCE_RE.exec(lines[i])) !== null) {
      refs.push({
        filePath: match[1],
        blockName: match[2],
        line: i + 1,
        column: match.index + 1,
        raw: match[0],
      });
    }
  }

  return { refs, errors };
}
