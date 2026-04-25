import { test, expect, describe } from "vitest";
import {
  referenceKey,
  passageAnchorId,
  docPathToUrl,
  buildReferenceMap,
  verifyUniqueReferences,
  buildPassageLocationMap,
} from "./reference-map.ts";

describe("referenceKey", () => {
  describe("when given a simple passage reference", () => {
    test("returns filePath:passageName", () => {
      expect(referenceKey("src/cli.ts", "lint")).toBe("src/cli.ts:lint");
    });
  });

  describe("when given a whole-file reference", () => {
    test("returns filePath: with empty passage", () => {
      expect(referenceKey("src/cli.ts", undefined)).toBe("src/cli.ts:");
    });
  });

  describe("when given a range reference", () => {
    test("returns filePath@start..end with stringified markers", () => {
      const key = referenceKey("src/cli.ts", undefined, { type: "START" }, { type: "END" });
      expect(key).toBe("src/cli.ts@START..END");
    });

    test("includes passage names in named markers", () => {
      const key = referenceKey(
        "src/cli.ts",
        undefined,
        { type: "start", passageName: "foo" },
        { type: "end", passageName: "bar" },
      );
      expect(key).toBe("src/cli.ts@start(#foo)..end(#bar)");
    });
  });
});

describe("passageAnchorId", () => {
  describe("when given a passage key", () => {
    test("returns a slugified string with spool- prefix", () => {
      expect(passageAnchorId("src/cli.ts:lint")).toBe("spool-src-cli-ts-lint");
    });
  });

  describe("when given a whole-file key", () => {
    test("strips the trailing separator", () => {
      expect(passageAnchorId("src/cli.ts:")).toBe("spool-src-cli-ts");
    });
  });

  describe("when given a key with uppercase characters", () => {
    test("lowercases everything", () => {
      expect(passageAnchorId("src/MyComponent.tsx:render")).toBe(
        "spool-src-mycomponent-tsx-render",
      );
    });
  });
});

describe("docPathToUrl", () => {
  describe("when given a simple markdown file", () => {
    test("replaces .md with .html and prepends /", () => {
      expect(docPathToUrl("guide.md")).toBe("/guide.html");
    });
  });

  describe("when given a nested path", () => {
    test("preserves the directory structure", () => {
      expect(docPathToUrl("guide/intro.md")).toBe("/guide/intro.html");
    });
  });
});

describe("buildReferenceMap", () => {
  describe("when docs contain passage references", () => {
    test("maps each reference key to its doc page", () => {
      const docs = new Map([
        ["01-cli.md", "::SPOOL:: <<src/cli.ts#lint>>"],
        ["02-lint.md", "::SPOOL:: <<src/cli.ts#lsp>>"],
      ]);
      const map = buildReferenceMap(docs);

      expect(map.get("src/cli.ts:lint")).toEqual([{ docPath: "01-cli.md", line: 1 }]);
      expect(map.get("src/cli.ts:lsp")).toEqual([{ docPath: "02-lint.md", line: 1 }]);
    });
  });

  describe("when the same passage is referenced on multiple pages", () => {
    test("collects all locations", () => {
      const docs = new Map([
        ["01-cli.md", "::SPOOL:: <<src/cli.ts#lint>>"],
        ["02-lint.md", "::SPOOL:: <<src/cli.ts#lint>>"],
      ]);
      const map = buildReferenceMap(docs);

      expect(map.get("src/cli.ts:lint")).toEqual([
        { docPath: "01-cli.md", line: 1 },
        { docPath: "02-lint.md", line: 1 },
      ]);
    });
  });

  describe("when a doc contains a whole-file reference", () => {
    test("uses the filePath: key format", () => {
      const docs = new Map([["index.md", "::SPOOL:: <<src/cli.ts>>"]]);
      const map = buildReferenceMap(docs);

      expect(map.has("src/cli.ts:")).toBe(true);
    });
  });
});

describe("verifyUniqueReferences", () => {
  describe("when all references are unique across pages", () => {
    test("returns no errors", () => {
      const docs = new Map([
        ["01-cli.md", "::SPOOL:: <<src/cli.ts#lint>>"],
        ["02-lint.md", "::SPOOL:: <<src/cli.ts#lsp>>"],
      ]);
      const map = buildReferenceMap(docs);
      const errors = verifyUniqueReferences(map);

      expect(errors).toEqual([]);
    });
  });

  describe("when a passage is referenced on multiple pages", () => {
    test("returns errors for each occurrence", () => {
      const docs = new Map([
        ["01-cli.md", "::SPOOL:: <<src/cli.ts#lint>>"],
        ["02-lint.md", "::SPOOL:: <<src/cli.ts#lint>>"],
      ]);
      const map = buildReferenceMap(docs);
      const errors = verifyUniqueReferences(map);

      expect(errors.length).toBe(2);
      expect(errors[0]!.message).toContain("src/cli.ts:lint");
      expect(errors[0]!.message).toContain("01-cli.md");
      expect(errors[0]!.message).toContain("02-lint.md");
    });
  });

  describe("when the same passage is referenced twice on the same page", () => {
    test("returns no errors", () => {
      const docs = new Map([["01-cli.md", "::SPOOL:: <<src/cli.ts#lint>>\n::SPOOL:: <<src/cli.ts#lint>>"]]);
      const map = buildReferenceMap(docs);
      const errors = verifyUniqueReferences(map);

      expect(errors).toEqual([]);
    });
  });
});

describe("buildPassageLocationMap", () => {
  describe("when a passage appears on exactly one page", () => {
    test("includes it in the map with url and anchor", () => {
      const docs = new Map([["02-lint.md", "::SPOOL:: <<src/cli.ts#lint>>"]]);
      const refMap = buildReferenceMap(docs);
      const locMap = buildPassageLocationMap(refMap);

      const info = locMap.get("src/cli.ts:lint");
      expect(info).toBeDefined();
      expect(info!.docPath).toBe("02-lint.md");
      expect(info!.anchorId).toBe("spool-src-cli-ts-lint");
      expect(info!.url).toBe("/02-lint.html#spool-src-cli-ts-lint");
    });
  });

  describe("when a passage appears on multiple pages", () => {
    test("excludes it from the map", () => {
      const docs = new Map([
        ["01-cli.md", "::SPOOL:: <<src/cli.ts#lint>>"],
        ["02-lint.md", "::SPOOL:: <<src/cli.ts#lint>>"],
      ]);
      const refMap = buildReferenceMap(docs);
      const locMap = buildPassageLocationMap(refMap);

      expect(locMap.has("src/cli.ts:lint")).toBe(false);
    });
  });
});
