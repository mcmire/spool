import { test, expect, describe } from "vitest";
import { parseSourcePassages, parsePassageReferences } from "./parser.ts";

describe("parseSourcePassages", () => {
  describe("valid annotations", () => {
    test("basic start/end with == decorators", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// == ::SPOOL:: start(#car) ==",
          "export class Car {}",
          "// == ::SPOOL:: end(#car) ==",
        ].join("\n"),
      );
      expect(passages.get("car")).toBe("export class Car {}");
      expect(errors).toEqual([]);
    });

    test("start/end without == decorators", () => {
      const { passages, errors } = parseSourcePassages(
        ["// ::SPOOL:: start(#car)", "export class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
      );
      expect(passages.get("car")).toBe("export class Car {}");
      expect(errors).toEqual([]);
    });

    test("different comment prefixes", () => {
      for (const prefix of ["//", "#", "--", "%", ";"]) {
        const { errors } = parseSourcePassages(
          [`${prefix} ::SPOOL:: start(#thing)`, "code", `${prefix} ::SPOOL:: end(#thing)`].join(
            "\n",
          ),
        );
        expect(errors).toEqual([]);
      }
    });

    test("nested passages", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// ::SPOOL:: start(#outer)",
          "line a",
          "// ::SPOOL:: start(#inner)",
          "line b",
          "// ::SPOOL:: end(#inner)",
          "line c",
          "// ::SPOOL:: end(#outer)",
        ].join("\n"),
      );
      expect(passages.get("inner")).toBe("line b");
      expect(passages.get("outer")).toBe("line a\nline b\nline c");
      expect(errors).toEqual([]);
    });

    test("hyphenated passage names", () => {
      const { errors } = parseSourcePassages(
        ["// ::SPOOL:: start(#my-passage)", "code", "// ::SPOOL:: end(#my-passage)"].join("\n"),
      );
      expect(errors).toEqual([]);
    });

    test("non-annotated lines are not affected", () => {
      const { passages, errors } = parseSourcePassages(
        ["just a normal line", "another line"].join("\n"),
      );
      expect(passages.size).toBe(0);
      expect(errors).toEqual([]);
    });

    test("markers inside an ignore block are not parsed", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// ::SPOOL:: ignore-start",
          "// ::SPOOL:: start(#car)",
          "export class Car {}",
          "// ::SPOOL:: end(#car)",
          "// ::SPOOL:: ignore-end",
        ].join("\n"),
      );
      expect(passages.size).toBe(0);
      expect(errors).toEqual([]);
    });

    test("passages outside an ignore block are still parsed", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// ::SPOOL:: start(#before)",
          "line a",
          "// ::SPOOL:: end(#before)",
          "// ::SPOOL:: ignore-start",
          "// ::SPOOL:: start(#ignored)",
          "line b",
          "// ::SPOOL:: end(#ignored)",
          "// ::SPOOL:: ignore-end",
          "// ::SPOOL:: start(#after)",
          "line c",
          "// ::SPOOL:: end(#after)",
        ].join("\n"),
      );
      expect(passages.get("before")).toBe("line a");
      expect(passages.get("after")).toBe("line c");
      expect(passages.has("ignored")).toBe(false);
      expect(errors).toEqual([]);
    });

    test("malformed ::SPOOL:: inside an ignore block produces no error", () => {
      const { errors } = parseSourcePassages(
        [
          "// ::SPOOL:: ignore-start",
          "const re = /::SPOOL:: start/;",
          "// ::SPOOL:: ignore-end",
        ].join("\n"),
      );
      expect(errors).toEqual([]);
    });

    test("ignore markers themselves do not appear as passage content", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// ::SPOOL:: start(#outer)",
          "before",
          "// ::SPOOL:: ignore-start",
          "ignored content",
          "// ::SPOOL:: ignore-end",
          "after",
          "// ::SPOOL:: end(#outer)",
        ].join("\n"),
      );
      expect(passages.get("outer")).toBe("before\nafter");
      expect(errors).toEqual([]);
    });

    test("ignore-next skips the following line", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// ::SPOOL:: ignore-next",
          "// ::SPOOL:: start(#car)",
          "export class Car {}",
          "// ::SPOOL:: ignore-next",
          "// ::SPOOL:: end(#car)",
        ].join("\n"),
      );
      expect(passages.size).toBe(0);
      expect(errors).toEqual([]);
    });

    test("ignore-next only skips one line", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// ::SPOOL:: ignore-next",
          "// ::SPOOL:: start(#skipped)",
          "// ::SPOOL:: start(#kept)",
          "content",
          "// ::SPOOL:: end(#kept)",
        ].join("\n"),
      );
      expect(passages.has("skipped")).toBe(false);
      expect(passages.get("kept")).toBe("content");
      expect(errors).toEqual([]);
    });

    test("malformed ::SPOOL:: on the next line after ignore-next produces no error", () => {
      const { errors } = parseSourcePassages(
        ["// ::SPOOL:: ignore-next", "const re = /::SPOOL:: start/;"].join("\n"),
      );
      expect(errors).toEqual([]);
    });

    test("ignore-next line itself does not appear as passage content", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// ::SPOOL:: start(#outer)",
          "before",
          "// ::SPOOL:: ignore-next",
          "skipped",
          "after",
          "// ::SPOOL:: end(#outer)",
        ].join("\n"),
      );
      expect(passages.get("outer")).toBe("before\nafter");
      expect(errors).toEqual([]);
    });
  });

  describe("wholeFile output", () => {
    test("plain file with no annotations returns the full content", () => {
      const { wholeFile, wholeFileNestedRefs, errors } = parseSourcePassages(
        "const x = 1;\nconst y = 2;",
      );
      expect(errors).toEqual([]);
      expect(wholeFile).toBe("const x = 1;\nconst y = 2;");
      expect(wholeFileNestedRefs).toEqual([]);
    });

    test("annotation marker lines are stripped from wholeFile", () => {
      const { wholeFile } = parseSourcePassages(
        ["// ::SPOOL:: start(#car)", "export class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
      );
      expect(wholeFile).toBe("export class Car {}");
    });

    test("ignored lines and ignore markers are stripped from wholeFile", () => {
      const { wholeFile } = parseSourcePassages(
        ["before", "// ::SPOOL:: ignore-start", "hidden", "// ::SPOOL:: ignore-end", "after"].join(
          "\n",
        ),
      );
      expect(wholeFile).toBe("before\nafter");
    });

    test("ignore-next target line is stripped from wholeFile", () => {
      const { wholeFile } = parseSourcePassages(
        ["before", "// ::SPOOL:: ignore-next", "skipped", "after"].join("\n"),
      );
      expect(wholeFile).toBe("before\nafter");
    });

    test("top-level passages are tracked as wholeFileNestedRefs", () => {
      const { wholeFile, wholeFileNestedRefs, errors } = parseSourcePassages(
        [
          "preamble",
          "// ::SPOOL:: start(#car)",
          "class Car {}",
          "// ::SPOOL:: end(#car)",
          "epilogue",
        ].join("\n"),
      );
      expect(errors).toEqual([]);
      expect(wholeFile).toBe("preamble\nclass Car {}\nepilogue");
      expect(wholeFileNestedRefs).toEqual([{ name: "car", prefix: "// ", startIdx: 1, endIdx: 2 }]);
    });

    test("multiple top-level passages are all tracked in wholeFileNestedRefs", () => {
      const { wholeFileNestedRefs } = parseSourcePassages(
        [
          "// ::SPOOL:: start(#a)",
          "class A {}",
          "// ::SPOOL:: end(#a)",
          "// ::SPOOL:: start(#b)",
          "class B {}",
          "// ::SPOOL:: end(#b)",
        ].join("\n"),
      );
      expect(wholeFileNestedRefs).toEqual([
        { name: "a", prefix: "// ", startIdx: 0, endIdx: 1 },
        { name: "b", prefix: "// ", startIdx: 1, endIdx: 2 },
      ]);
    });

    test("nested passages do not appear as separate wholeFileNestedRefs entries", () => {
      const { wholeFileNestedRefs } = parseSourcePassages(
        [
          "// ::SPOOL:: start(#outer)",
          "line a",
          "// ::SPOOL:: start(#inner)",
          "line b",
          "// ::SPOOL:: end(#inner)",
          "line c",
          "// ::SPOOL:: end(#outer)",
        ].join("\n"),
      );
      expect(wholeFileNestedRefs).toHaveLength(1);
      expect(wholeFileNestedRefs[0]!.name).toBe("outer");
    });
  });

  describe("invalid annotations", () => {
    test("::SPOOL:: with no directive produces generic error", () => {
      const { errors } = parseSourcePassages(["// ::SPOOL::"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 9,
          message: "Expected '::SPOOL:: start(#name)' or '::SPOOL:: end(#name)'",
        },
      ]);
    });

    test("::SPOOL:: + start with unclosed paren produces generic error", () => {
      const { errors } = parseSourcePassages(["// ::SPOOL:: start("].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 16,
          message: "Unclosed parenthesis. Expected '::SPOOL:: start(#name)'",
        },
      ]);
    });

    test("::SPOOL:: + end with unclosed paren produces generic error", () => {
      const { errors } = parseSourcePassages(["// ::SPOOL:: end("].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 14,
          message: "Unclosed parenthesis. Expected '::SPOOL:: end(#name)'",
        },
      ]);
    });

    test("unknown directive produces specific error", () => {
      const { errors } = parseSourcePassages(["// ::SPOOL:: foo(#car)"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 19,
          message: "Expected directive 'start' or 'end', got 'foo(#car)'",
        },
      ]);
    });

    test("valid directive with no name produces error", () => {
      const { errors } = parseSourcePassages(["// ::SPOOL:: start"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 15,
          message: "Expected passage name in the form '(#name)'",
        },
      ]);
    });

    test("missing # in name produces error", () => {
      const { errors } = parseSourcePassages(["// ::SPOOL:: start(car)"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 20,
          message: "Expected passage name in the form '(#name)'",
        },
      ]);
    });

    test("empty name produces error", () => {
      const { errors } = parseSourcePassages(["// ::SPOOL:: start(#)"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 18,
          message: "Expected passage name in the form '(#name)'",
        },
      ]);
    });

    test("open without close", () => {
      const { errors } = parseSourcePassages(["// ::SPOOL:: start(#car)", "code"].join("\n"));
      expect(errors).toEqual([{ line: 1, column: 1, message: 'Unclosed passage "car"' }]);
    });

    test("close without open", () => {
      const { errors } = parseSourcePassages(["// ::SPOOL:: end(#car)"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 1,
          message: 'Closing passage "car" without matching open',
        },
      ]);
    });

    test("mismatched close", () => {
      const { errors } = parseSourcePassages(
        ["// ::SPOOL:: start(#car)", "// ::SPOOL:: end(#boat)"].join("\n"),
      );
      expect(errors).toEqual([
        {
          line: 2,
          column: 1,
          message: 'Mismatched close: expected "car", got "boat"',
        },
        { line: 1, column: 1, message: 'Unclosed passage "car"' },
      ]);
    });

    test("duplicate passage name", () => {
      const { errors } = parseSourcePassages(
        [
          "// ::SPOOL:: start(#car)",
          "code",
          "// ::SPOOL:: end(#car)",
          "// ::SPOOL:: start(#car)",
          "more code",
          "// ::SPOOL:: end(#car)",
        ].join("\n"),
      );
      expect(errors).toEqual([
        {
          line: 4,
          column: 1,
          message: 'Duplicate passage name "car" in same file',
        },
      ]);
    });
  });
});

describe("parsePassageReferences", () => {
  describe("valid references", () => {
    test("basic reference", () => {
      const { refs, errors } = parsePassageReferences(
        ["// ::SPOOL:: <<src/car.ts#car>>"].join("\n"),
      );
      expect(refs).toEqual([
        {
          filePath: "src/car.ts",
          passageName: "car",
          modifier: undefined,
          line: 1,
          column: 4,
          raw: "::SPOOL:: <<src/car.ts#car>>",
        },
      ]);
      expect(errors).toEqual([]);
    });

    test("reference with modifier", () => {
      const { refs, errors } = parsePassageReferences(
        ["// ::SPOOL:: <<src/car.ts#car:no-expand-nested>>"].join("\n"),
      );
      expect(refs).toEqual([
        {
          filePath: "src/car.ts",
          passageName: "car",
          modifier: "no-expand-nested",
          line: 1,
          column: 4,
          raw: "::SPOOL:: <<src/car.ts#car:no-expand-nested>>",
        },
      ]);
      expect(errors).toEqual([]);
    });

    test("whole-file reference with no passage ID", () => {
      const { refs, errors } = parsePassageReferences(["// ::SPOOL:: <<src/cli.ts>>"].join("\n"));
      expect(refs).toEqual([
        {
          filePath: "src/cli.ts",
          passageName: undefined,
          modifier: undefined,
          line: 1,
          column: 4,
          raw: "::SPOOL:: <<src/cli.ts>>",
        },
      ]);
      expect(errors).toEqual([]);
    });

    test("whole-file reference with modifier but no passage ID", () => {
      const { refs, errors } = parsePassageReferences(
        ["// ::SPOOL:: <<src/cli.ts:no-expand-nested>>"].join("\n"),
      );
      expect(refs).toEqual([
        {
          filePath: "src/cli.ts",
          passageName: undefined,
          modifier: "no-expand-nested",
          line: 1,
          column: 4,
          raw: "::SPOOL:: <<src/cli.ts:no-expand-nested>>",
        },
      ]);
      expect(errors).toEqual([]);
    });

    test("non-reference lines are not affected", () => {
      const { refs, errors } = parsePassageReferences(
        ["just a normal line", "another line"].join("\n"),
      );
      expect(refs).toHaveLength(0);
      expect(errors).toEqual([]);
    });
  });

  describe("invalid references", () => {
    test("::SPOOL:: with no angle brackets produces error", () => {
      const { errors } = parsePassageReferences(["// ::SPOOL::"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 9,
          message:
            "Expected reference to match '::SPOOL:: <<file-path>>' or '::SPOOL:: <<file-path#passage-id>>'",
        },
      ]);
    });
  });
});
