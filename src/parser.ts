export type ParseError = {
  line: number;
  column: number;
  message: string;
};

export type PassageReference = {
  filePath: string;
  passageName: string;
  modifier?: string;
  line: number;
  column: number;
  raw: string;
};

export type NestedRef = {
  name: string;
  prefix: string;
  startIdx: number;
  endIdx: number;
};

type Frame = { name: string; lines: string[]; nestedRefs: NestedRef[] };

export const VALID_MODIFIERS = new Set(["no-expand-nested"]);

const SOURCE_ANNOTATION_RE = /^(.*?)::spool::\s*<(\/?)([\w-]+)>\s*$/;
const PASSAGE_REFERENCE_RE = /^.*?::spool::\s*\{\{(.+?):([\w-]+)(?::([\w-]+))?\}\}/;

export function parseSourcePassages(content: string): {
  passages: Map<string, string>;
  passageNestedRefs: Map<string, NestedRef[]>;
  errors: ParseError[];
} {
  const passages = new Map<string, string>();
  const passageNestedRefs = new Map<string, NestedRef[]>();
  const errors: ParseError[] = [];
  const stack: Frame[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = SOURCE_ANNOTATION_RE.exec(line);

    if (match) {
      const isClosing = match[2]! === "/";
      const passageName = match[3]!;

      if (isClosing) {
        if (stack.length === 0) {
          errors.push({
            line: i + 1,
            column: 1,
            message: `Closing passage </${passageName}> without matching open`,
          });
        } else if (stack[stack.length - 1]!.name !== passageName) {
          errors.push({
            line: i + 1,
            column: 1,
            message: `Mismatched close: expected </${stack[stack.length - 1]!.name}>, got </${passageName}>`,
          });
        } else {
          const closed = stack.pop()!;
          passages.set(passageName, closed.lines.join("\n"));
          passageNestedRefs.set(passageName, closed.nestedRefs);
          if (stack.length > 0) {
            const parent = stack[stack.length - 1]!;
            parent.nestedRefs[parent.nestedRefs.length - 1]!.endIdx = parent.lines.length;
          }
        }
      } else {
        if (passages.has(passageName)) {
          errors.push({
            line: i + 1,
            column: 1,
            message: `Duplicate passage name "${passageName}" in same file`,
          });
        }
        if (stack.length > 0) {
          const parent = stack[stack.length - 1]!;
          parent.nestedRefs.push({ name: passageName, prefix: match[1]!, startIdx: parent.lines.length, endIdx: -1 });
        }
        stack.push({ name: passageName, lines: [], nestedRefs: [] });
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
      message: `Unclosed passage <${frame.name}>`,
    });
  }

  return { passages, passageNestedRefs, errors };
}

export function parsePassageReferences(content: string): {
  refs: PassageReference[];
  errors: ParseError[];
} {
  const refs: PassageReference[] = [];
  const errors: ParseError[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = PASSAGE_REFERENCE_RE.exec(lines[i]!);
    if (match) {
      const modifier = match[3];
      const raw = modifier
        ? `{{${match[1]!}:${match[2]!}:${modifier}}}`
        : `{{${match[1]!}:${match[2]!}}}`;
      refs.push({
        filePath: match[1]!,
        passageName: match[2]!,
        modifier,
        line: i + 1,
        column: match[0]!.indexOf("{{") + 1,
        raw,
      });
    }
  }

  return { refs, errors };
}
