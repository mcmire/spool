import { test, expect, describe } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";
import { getSourceFileDiagnostics, getDocFileDiagnostics } from "./diagnostics.ts";
import type {
  PassageRegistry,
  PassageTemplateRegistry,
  PassagePositions,
  FilePositions,
} from "../../registries.ts";

describe("getSourceFileDiagnostics", () => {
  describe("when the source contains no annotations", () => {
    test("returns no diagnostics", () => {
      const diagnostics = getSourceFileDiagnostics("just normal code\nmore code");
      expect(diagnostics).toEqual([]);
    });
  });

  describe("when the source contains a valid passage", () => {
    test("returns no diagnostics", () => {
      const diagnostics = getSourceFileDiagnostics(
        ["// ::SPOOL:: start(#car)", "export class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
      );
      expect(diagnostics).toEqual([]);
    });
  });

  describe("when the source contains a malformed annotation", () => {
    test("returns a diagnostic with the correct range and message", () => {
      const diagnostics = getSourceFileDiagnostics("// ::SPOOL:: foo(#car)");
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 22 },
          },
          message: "Expected directive 'start' or 'end', got 'foo(#car)'",
          source: "spool",
        },
      ]);
    });
  });

  describe("when the source contains an unclosed passage", () => {
    test("returns a diagnostic with a zero-length range", () => {
      const diagnostics = getSourceFileDiagnostics(["// ::SPOOL:: start(#car)", "code"].join("\n"));
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          message: 'Unclosed passage "car"',
          source: "spool",
        },
      ]);
    });
  });

  describe("when the annotation is on the second line", () => {
    test("returns a diagnostic with the correct line index", () => {
      const diagnostics = getSourceFileDiagnostics(
        ["normal code", "// ::SPOOL:: bad(#car)"].join("\n"),
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 22 },
          },
          message: "Expected directive 'start' or 'end', got 'bad(#car)'",
          source: "spool",
        },
      ]);
    });
  });
});

describe("getDocFileDiagnostics", () => {
  const emptyPassagePositions: PassagePositions = new Map();

  describe("when the reference resolves to a known passage", () => {
    test("returns no diagnostics", () => {
      const registry: PassageRegistry = new Map([["src/car.ts:car", "export class Car {}"]]);
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<src/car.ts#car>>",
        registry,
        templateRegistry,
        emptyPassagePositions,
      );
      expect(diagnostics).toEqual([]);
    });
  });

  describe("when a no-expand-nested reference resolves in the templateRegistry", () => {
    test("returns no diagnostics", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map([["src/car.ts:car", "code"]]);
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<src/car.ts#car:no-expand-nested>>",
        registry,
        templateRegistry,
        emptyPassagePositions,
      );
      expect(diagnostics).toEqual([]);
    });
  });

  describe("when the referenced file is not in the registry", () => {
    test("returns an 'Unknown file' diagnostic", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<src/car.ts#car>>",
        registry,
        templateRegistry,
        emptyPassagePositions,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 31 },
          },
          message: "Unknown file: src/car.ts",
          source: "spool",
        },
      ]);
    });
  });

  describe("when the file is in the registry but the passage is not", () => {
    test("returns an 'Unknown passage ID' diagnostic", () => {
      const registry: PassageRegistry = new Map([["src/car.ts:boat", "code"]]);
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<src/car.ts#car>>",
        registry,
        templateRegistry,
        emptyPassagePositions,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 31 },
          },
          message: 'Unknown passage ID "car" in file src/car.ts',
          source: "spool",
        },
      ]);
    });
  });

  describe("when the reference uses an unknown modifier", () => {
    test("returns an 'Unknown modifier' diagnostic", () => {
      const registry: PassageRegistry = new Map([["src/car.ts:car", "code"]]);
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<src/car.ts#car:bad-modifier>>",
        registry,
        templateRegistry,
        emptyPassagePositions,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 44 },
          },
          message: "Unknown modifier: bad-modifier",
          source: "spool",
        },
      ]);
    });
  });

  describe("when a no-expand-nested reference file is not in the templateRegistry", () => {
    test("returns an 'Unknown file' diagnostic", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<src/car.ts#car:no-expand-nested>>",
        registry,
        templateRegistry,
        emptyPassagePositions,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 48 },
          },
          message: "Unknown file: src/car.ts",
          source: "spool",
        },
      ]);
    });
  });

  describe("when the reference is malformed", () => {
    test("returns a parse error diagnostic", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL::",
        registry,
        templateRegistry,
        emptyPassagePositions,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 12 },
          },
          message:
            "Expected reference to match '::SPOOL:: <<file>>', '::SPOOL:: <<file#passage>>', or '::SPOOL:: <<file@start..end>>'",
          source: "spool",
        },
      ]);
    });
  });

  describe("when the doc contains a valid range reference", () => {
    test("returns no diagnostics", () => {
      const registry: PassageRegistry = new Map([["src/cli.ts:", "const x = 1;"]]);
      const templateRegistry: PassageTemplateRegistry = new Map();
      const filePositions: FilePositions = new Map([
        ["", { startLine: 1, endLine: 1 }],
        ["weave", { startLine: 1, endLine: 1 }],
      ]);
      const passagePositions: PassagePositions = new Map([["src/cli.ts", filePositions]]);
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<src/cli.ts@START..start(#weave)>>",
        registry,
        templateRegistry,
        passagePositions,
      );
      expect(diagnostics).toEqual([]);
    });
  });

  describe("when a range reference points to an unknown file", () => {
    test("returns an 'Unknown file' diagnostic", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<src/cli.ts@START..END>>",
        registry,
        templateRegistry,
        emptyPassagePositions,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 38 },
          },
          message: "Unknown file: src/cli.ts",
          source: "spool",
        },
      ]);
    });
  });

  describe("when a range reference uses an unknown named passage in a marker", () => {
    test("returns an 'Unknown passage' diagnostic", () => {
      const registry: PassageRegistry = new Map([["src/cli.ts:", "const x = 1;"]]);
      const templateRegistry: PassageTemplateRegistry = new Map();
      const filePositions: FilePositions = new Map([["", { startLine: 1, endLine: 1 }]]);
      const passagePositions: PassagePositions = new Map([["src/cli.ts", filePositions]]);
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<src/cli.ts@START..start(#missing)>>",
        registry,
        templateRegistry,
        passagePositions,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 50 },
          },
          message: 'Unknown passage "#missing" in file src/cli.ts',
          source: "spool",
        },
      ]);
    });
  });

  describe("when the reference is on the second line", () => {
    test("returns a diagnostic with the correct line index", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        ["normal text", "// ::SPOOL:: <<src/car.ts#car>>"].join("\n"),
        registry,
        templateRegistry,
        emptyPassagePositions,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 31 },
          },
          message: "Unknown file: src/car.ts",
          source: "spool",
        },
      ]);
    });
  });
});
