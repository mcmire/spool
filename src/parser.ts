export type ParseError = {
  line: number;
  column: number;
  length?: number;
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

const SOURCE_ANNOTATION_RE = /^(.*?)(?:==\s*)?::SPOOL::\s+(start|end)\(#([\w-]+)\)(?:\s*==)?\s*$/;
const SOURCE_DIRECTIVE_RE = /^.*?::SPOOL::\s+(\S+)/;
const SOURCE_IGNORE_RE = /^.*?::SPOOL::\s+(ignore-start|ignore-end|ignore-next)\s*$/;
const PASSAGE_REFERENCE_RE = /^(.*?)::SPOOL::\s+<<(.+?)#([\w-]+)(?::([\w-]+))?>>/;

function magicCommentError(line: string, lineNum: number): ParseError {
  const col = line.indexOf("::SPOOL::") + 1;
  const directiveMatch = SOURCE_DIRECTIVE_RE.exec(line);

  if (!directiveMatch) {
    return {
      line: lineNum,
      column: col,
      length: "::SPOOL::".length,
      message: "Expected '::SPOOL:: start(#name)' or '::SPOOL:: end(#name)'",
    };
  }

  const directive = directiveMatch[1]!;
  const directiveLength = directiveMatch[0]!.length - directiveMatch[0]!.indexOf("::SPOOL::");

  if (
    directive !== "start" &&
    directive !== "end" &&
    !directive.startsWith("start") &&
    !directive.startsWith("end")
  ) {
    return {
      line: lineNum,
      column: col,
      length: directiveLength,
      message: `Expected directive 'start' or 'end', got '${directive}'`,
    };
  }

  const verb = directive.startsWith("end") ? "end" : "start";
  if (directive.includes("(") && !directive.includes(")")) {
    return {
      line: lineNum,
      column: col,
      length: directiveLength,
      message: `Unclosed parenthesis. Expected '::SPOOL:: ${verb}(#name)'`,
    };
  }

  return {
    line: lineNum,
    column: col,
    length: directiveLength,
    message: "Expected passage name in the form '(#name)'",
  };
}

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
  let ignoring = false;
  let ignoreNext = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    const ignoreMatch = SOURCE_IGNORE_RE.exec(line);
    if (ignoreMatch) {
      const directive = ignoreMatch[1]!;
      if (directive === "ignore-next") {
        ignoreNext = true;
      } else {
        ignoring = directive === "ignore-start";
      }
      continue;
    }

    if (ignoring) {
      continue;
    }

    if (ignoreNext) {
      ignoreNext = false;
      continue;
    }

    const match = SOURCE_ANNOTATION_RE.exec(line);

    if (match) {
      const isClosing = match[2]! === "end";
      const passageName = match[3]!;
      const prefix = match[1]!;

      if (isClosing) {
        if (stack.length === 0) {
          errors.push({
            line: i + 1,
            column: 1,
            message: `Closing passage "${passageName}" without matching open`,
          });
        } else if (stack[stack.length - 1]!.name !== passageName) {
          errors.push({
            line: i + 1,
            column: 1,
            message: `Mismatched close: expected "${stack[stack.length - 1]!.name}", got "${passageName}"`,
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
          parent.nestedRefs.push({
            name: passageName,
            prefix,
            startIdx: parent.lines.length,
            endIdx: -1,
          });
        }
        stack.push({ name: passageName, lines: [], nestedRefs: [] });
      }
    } else if (line.includes("::SPOOL::")) {
      errors.push(magicCommentError(line, i + 1));
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
      message: `Unclosed passage "${frame.name}"`,
    });
  }

  return { passages, passageNestedRefs, errors };
}

function malformedReferenceError(line: string, lineNum: number): ParseError {
  const col = line.indexOf("::SPOOL::") + 1;
  const closeIdx = line.indexOf(">>", col - 1);
  const length = closeIdx >= 0 ? closeIdx + 2 - (col - 1) : "::SPOOL::".length;
  return {
    line: lineNum,
    column: col,
    length,
    message: "Expected reference to match '::SPOOL:: <<file-path#passage-id>>'",
  };
}

export function parsePassageReferences(content: string): {
  refs: PassageReference[];
  errors: ParseError[];
} {
  const refs: PassageReference[] = [];
  const errors: ParseError[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = PASSAGE_REFERENCE_RE.exec(line);
    if (match) {
      const modifier = match[4];
      const raw = modifier
        ? `::SPOOL:: <<${match[2]!}#${match[3]!}:${modifier}>>`
        : `::SPOOL:: <<${match[2]!}#${match[3]!}>>`;
      refs.push({
        filePath: match[2]!,
        passageName: match[3]!,
        modifier,
        line: i + 1,
        column: match[0]!.indexOf("::SPOOL::") + 1,
        raw,
      });
    } else if (line.includes("::SPOOL::")) {
      errors.push(malformedReferenceError(line, i + 1));
    }
  }

  return { refs, errors };
}
