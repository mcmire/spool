import { test, expect, describe } from "bun:test";
import { parseSourcePassages, parsePassageReferences } from "./parser.ts";

describe("parseSourcePassages", () => {
  describe("valid annotations", () => {
    test("basic start/end with == decorators", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// == @SPOOL(start): #car ==",
          "export class Car {}",
          "// == @SPOOL(end): #car ==",
        ].join("\n"),
      );
      expect(passages.get("car")).toBe("export class Car {}");
      expect(errors).toEqual([]);
    });

    test("start/end without == decorators", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// @SPOOL(start): #car",
          "export class Car {}",
          "// @SPOOL(end): #car",
        ].join("\n"),
      );
      expect(passages.get("car")).toBe("export class Car {}");
      expect(errors).toEqual([]);
    });

    test("different comment prefixes", () => {
      for (const prefix of ["//", "#", "--", "%", ";"]) {
        const { errors } = parseSourcePassages(
          [
            `${prefix} @SPOOL(start): #thing`,
            "code",
            `${prefix} @SPOOL(end): #thing`,
          ].join("\n"),
        );
        expect(errors).toEqual([]);
      }
    });

    test("nested passages", () => {
      const { passages, errors } = parseSourcePassages(
        [
          "// @SPOOL(start): #outer",
          "line a",
          "// @SPOOL(start): #inner",
          "line b",
          "// @SPOOL(end): #inner",
          "line c",
          "// @SPOOL(end): #outer",
        ].join("\n"),
      );
      expect(passages.get("inner")).toBe("line b");
      expect(passages.get("outer")).toBe("line a\nline b\nline c");
      expect(errors).toEqual([]);
    });

    test("hyphenated passage names", () => {
      const { errors } = parseSourcePassages(
        [
          "// @SPOOL(start): #my-passage",
          "code",
          "// @SPOOL(end): #my-passage",
        ].join("\n"),
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
  });

  describe("invalid annotations", () => {
    test("@SPOOL with no directive produces generic error", () => {
      const { errors } = parseSourcePassages(["// @SPOOL"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 6,
          message:
            "Expected line to match '@SPOOL(start): #name' or '@SPOOL(end): #name'",
        },
      ]);
    });

    test("@SPOOL( with unclosed paren produces generic error", () => {
      const { errors } = parseSourcePassages(["// @SPOOL("].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 6,
          message:
            "Expected line to match '@SPOOL(start): #name' or '@SPOOL(end): #name'",
        },
      ]);
    });

    test("unknown directive produces specific error", () => {
      const { errors } = parseSourcePassages(
        ["// @SPOOL(foo): #car"].join("\n"),
      );
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 11,
          message: "Expected directive 'start' or 'end', got 'foo'",
        },
      ]);
    });

    test("valid directive with no colon produces generic error", () => {
      const { errors } = parseSourcePassages(["// @SPOOL(start)"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 13,
          message:
            "Expected line to match '@SPOOL(start): #name' or '@SPOOL(end): #name'",
        },
      ]);
    });

    test("missing # identifier produces specific error", () => {
      const { errors } = parseSourcePassages(
        ["// @SPOOL(start): car"].join("\n"),
      );
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 13,
          message: "Expected identifier ('#' followed by name)",
        },
      ]);
    });

    test("identifier with no name produces specific error", () => {
      const { errors } = parseSourcePassages(
        ["// @SPOOL(start): #"].join("\n"),
      );
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 13,
          message: "Expected identifier ('#' followed by name)",
        },
      ]);
    });

    test("open without close", () => {
      const { errors } = parseSourcePassages(
        ["// @SPOOL(start): #car", "code"].join("\n"),
      );
      expect(errors).toEqual([
        { line: 1, column: 1, message: 'Unclosed passage "car"' },
      ]);
    });

    test("close without open", () => {
      const { errors } = parseSourcePassages(
        ["// @SPOOL(end): #car"].join("\n"),
      );
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
        ["// @SPOOL(start): #car", "// @SPOOL(end): #boat"].join("\n"),
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
          "// @SPOOL(start): #car",
          "code",
          "// @SPOOL(end): #car",
          "// @SPOOL(start): #car",
          "more code",
          "// @SPOOL(end): #car",
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
        ["// <<@SPOOL: src/car.ts#car>>"].join("\n"),
      );
      expect(refs).toEqual([
        {
          filePath: "src/car.ts",
          passageName: "car",
          modifier: undefined,
          line: 1,
          column: 4,
          raw: "<<@SPOOL: src/car.ts#car>>",
        },
      ]);
      expect(errors).toEqual([]);
    });

    test("reference with modifier", () => {
      const { refs, errors } = parsePassageReferences(
        ["// <<@SPOOL: src/car.ts#car:no-expand-nested>>"].join("\n"),
      );
      expect(refs).toEqual([
        {
          filePath: "src/car.ts",
          passageName: "car",
          modifier: "no-expand-nested",
          line: 1,
          column: 4,
          raw: "<<@SPOOL: src/car.ts#car:no-expand-nested>>",
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
    test("<<@SPOOL with no colon", () => {
      const { errors } = parsePassageReferences(["// <<@SPOOL"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 8,
          message: "Expected reference to match '@SPOOL: file-path#passage-id'",
        },
      ]);
    });

    test("<<@SPOOL: with no path or name", () => {
      const { errors } = parsePassageReferences(["// <<@SPOOL:"].join("\n"));
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 8,
          message: "Expected reference to match '@SPOOL: file-path#passage-id'",
        },
      ]);
    });

    test("<<@SPOOL: with path but no # separator", () => {
      const { errors } = parsePassageReferences(
        ["// <<@SPOOL: sadlkj>>"].join("\n"),
      );
      expect(errors).toEqual([
        {
          line: 1,
          column: 4,
          length: 18,
          message: "Expected reference to match '@SPOOL: file-path#passage-id'",
        },
      ]);
    });
  });
});
