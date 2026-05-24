export type ParseError = {
  line: number;
  column: number;
  length?: number;
  message: string;
};

export type RangeMarker =
  | { type: "START" }
  | { type: "END" }
  | { type: "start"; passageName: string }
  | { type: "end"; passageName: string };

export type PassageReference = {
  filePath: string;
  passageName: string | undefined;
  modifier?: string;
  line: number;
  column: number;
  raw: string;
  isRange: boolean;
  rangeStart?: RangeMarker;
  rangeEnd?: RangeMarker;
};

export type NestedRef = {
  name: string;
  prefix: string;
  startIdx: number;
  endIdx: number;
};

type Frame = { name: string; lines: string[]; nestedRefs: NestedRef[] };

export const VALID_MODIFIERS = new Set(["no-expand-nested"]);

// ::SPOOL:: ignore-start
const SOURCE_ANNOTATION_RE = /^(.*?)(?:==\s*)?::SPOOL::\s+(start|end)\(#([\w-]+)\)(?:\s*==)?\s*$/;
const SOURCE_DIRECTIVE_RE = /^.*?::SPOOL::\s+(\S+)/;
const SOURCE_IGNORE_RE = /^.*?::SPOOL::\s+(ignore-start|ignore-end|ignore-next)\s*(?:-->)?\s*$/;
const PASSAGE_REFERENCE_RE = /^(.*?)::SPOOL::\s+<<(.+?)(?:#([\w-]+))?(?::([\w-]+))?>>/;
const PASSAGE_RANGE_RE =
  /^(.*?)::SPOOL::\s+<<(.+?)@((?:START|END|start\(#[\w-]+\)|end\(#[\w-]+\)))\.\.((?:START|END|start\(#[\w-]+\)|end\(#[\w-]+\)))>>/;
// ::SPOOL:: ignore-end

function magicCommentError(line: string, lineNum: number): ParseError {
  // ::SPOOL:: ignore-next
  const col = line.indexOf("::SPOOL::") + 1;
  const directiveMatch = SOURCE_DIRECTIVE_RE.exec(line);

  if (!directiveMatch) {
    return {
      line: lineNum,
      column: col,
      // ::SPOOL:: ignore-next
      length: "::SPOOL::".length,
      // ::SPOOL:: ignore-next
      message: "Expected '::SPOOL:: start(#name)' or '::SPOOL:: end(#name)'",
    };
  }

  const directive = directiveMatch[1]!;
  // ::SPOOL:: ignore-next
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
      // ::SPOOL:: ignore-next
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
  wholeFile: string;
  wholeFileNestedRefs: NestedRef[];
  errors: ParseError[];
} {
  const passages = new Map<string, string>();
  const passageNestedRefs = new Map<string, NestedRef[]>();
  const errors: ParseError[] = [];
  const stack: Frame[] = [];
  // Lines accumulated for the whole-file view (annotation markers and ignored lines stripped).
  const wholeFileLines: string[] = [];
  // Top-level passage refs tracked for the whole-file template.
  const wholeFileNestedRefs: NestedRef[] = [];
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
          } else {
            // Top-level passage just closed — record its end in the whole-file refs.
            wholeFileNestedRefs[wholeFileNestedRefs.length - 1]!.endIdx = wholeFileLines.length;
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
        } else {
          // Top-level passage opening — track it in the whole-file refs.
          wholeFileNestedRefs.push({
            name: passageName,
            prefix,
            startIdx: wholeFileLines.length,
            endIdx: -1,
          });
        }
        stack.push({ name: passageName, lines: [], nestedRefs: [] });
      }
      // ::SPOOL:: ignore-next
    } else if (line.includes("::SPOOL::")) {
      errors.push(magicCommentError(line, i + 1));
    } else {
      for (const frame of stack) {
        frame.lines.push(line);
      }
      // Only add to the whole-file view when not inside a passage that itself is
      // nested inside another — i.e. always, since all frames share the same lines.
      // We add every non-marker line to wholeFileLines regardless of stack depth.
      wholeFileLines.push(line);
    }
  }

  for (const frame of stack) {
    errors.push({
      line: 1,
      column: 1,
      message: `Unclosed passage "${frame.name}"`,
    });
  }

  return {
    passages,
    passageNestedRefs,
    wholeFile: wholeFileLines.join("\n"),
    wholeFileNestedRefs,
    errors,
  };
}

function malformedReferenceError(line: string, lineNum: number): ParseError {
  // ::SPOOL:: ignore-next
  const col = line.indexOf("::SPOOL::") + 1;
  const closeIdx = line.indexOf(">>", col - 1);
  // ::SPOOL:: ignore-next
  const length = closeIdx >= 0 ? closeIdx + 2 - (col - 1) : "::SPOOL::".length;
  return {
    line: lineNum,
    column: col,
    length,
    message:
      // ::SPOOL:: ignore-next
      "Expected reference to match '::SPOOL:: <<file>>', '::SPOOL:: <<file#passage>>', or '::SPOOL:: <<file@start..end>>'",
  };
}

function parseRangeMarker(marker: string): RangeMarker {
  if (marker === "START") {
    return { type: "START" };
  }
  if (marker === "END") {
    return { type: "END" };
  }
  const startMatch = /^start\(#([\w-]+)\)$/.exec(marker);
  if (startMatch) {
    return { type: "start", passageName: startMatch[1]! };
  }
  const endMatch = /^end\(#([\w-]+)\)$/.exec(marker);
  if (endMatch) {
    return { type: "end", passageName: endMatch[1]! };
  }
  throw new Error(`Invalid marker: ${marker}`);
}

export function parsePassageReferences(content: string): {
  refs: PassageReference[];
  directiveLineNums: Set<number>;
  errors: ParseError[];
} {
  const refs: PassageReference[] = [];
  const errors: ParseError[] = [];
  const directiveLineNums = new Set<number>();
  const lines = content.split("\n");
  let ignoring = false;
  let ignoreNext = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    const ignoreMatch = SOURCE_IGNORE_RE.exec(line);
    if (ignoreMatch) {
      directiveLineNums.add(lineNum);
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

    const rangeMatch = PASSAGE_RANGE_RE.exec(line);
    if (rangeMatch) {
      const rangeStartStr = rangeMatch[3]!;
      const rangeEndStr = rangeMatch[4]!;
      let rangeStart: RangeMarker;
      let rangeEnd: RangeMarker;
      try {
        rangeStart = parseRangeMarker(rangeStartStr);
        rangeEnd = parseRangeMarker(rangeEndStr);
      } catch {
        errors.push({
          line: i + 1,
          // ::SPOOL:: ignore-next
          column: line.indexOf("::SPOOL::") + 1,
          message: "Invalid range marker",
        });
        continue;
      }
      refs.push({
        filePath: rangeMatch[2]!,
        passageName: undefined,
        modifier: undefined,
        line: i + 1,
        // ::SPOOL:: ignore-next
        column: rangeMatch[0]!.indexOf("::SPOOL::") + 1,
        // ::SPOOL:: ignore-next
        raw: `::SPOOL:: <<${rangeMatch[2]!}@${rangeStartStr}..${rangeEndStr}>>`,
        isRange: true,
        rangeStart,
        rangeEnd,
      });
      continue;
    }
    const match = PASSAGE_REFERENCE_RE.exec(line);
    if (match) {
      if (match[2]!.includes("@")) {
        errors.push(malformedReferenceError(line, i + 1));
        continue;
      }
      const passageName = match[3];
      const modifier = match[4];
      let raw: string;
      if (passageName !== undefined && modifier !== undefined) {
        // ::SPOOL:: ignore-next
        raw = `::SPOOL:: <<${match[2]!}#${passageName}:${modifier}>>`;
      } else if (passageName !== undefined) {
        // ::SPOOL:: ignore-next
        raw = `::SPOOL:: <<${match[2]!}#${passageName}>>`;
      } else if (modifier !== undefined) {
        // ::SPOOL:: ignore-next
        raw = `::SPOOL:: <<${match[2]!}:${modifier}>>`;
      } else {
        // ::SPOOL:: ignore-next
        raw = `::SPOOL:: <<${match[2]!}>>`;
      }
      refs.push({
        filePath: match[2]!,
        passageName,
        modifier,
        line: i + 1,
        // ::SPOOL:: ignore-next
        column: match[0]!.indexOf("::SPOOL::") + 1,
        raw,
        isRange: false,
      });
      // ::SPOOL:: ignore-next
    } else if (line.includes("::SPOOL::")) {
      errors.push(malformedReferenceError(line, i + 1));
    }
  }

  return { refs, directiveLineNums, errors };
}
