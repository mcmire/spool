import { test, expect, describe } from "bun:test";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";
import { getSourceFileDiagnostics, getDocFileDiagnostics } from "./diagnostics.ts";
import type { PassageRegistry, PassageTemplateRegistry } from "../registries.ts";

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
      const diagnostics = getSourceFileDiagnostics(
        ["// ::SPOOL:: start(#car)", "code"].join("\n"),
      );
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
  describe("when the reference resolves to a known passage", () => {
    test("returns no diagnostics", () => {
      const registry: PassageRegistry = new Map([["src/car.ts:car", "export class Car {}"]]);
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<car.ts#car>>",
        registry,
        templateRegistry,
        "src",
      );
      expect(diagnostics).toEqual([]);
    });
  });

  describe("when a no-expand-nested reference resolves in the templateRegistry", () => {
    test("returns no diagnostics", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map([["src/car.ts:car", "code"]]);
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<car.ts#car:no-expand-nested>>",
        registry,
        templateRegistry,
        "src",
      );
      expect(diagnostics).toEqual([]);
    });
  });

  describe("when the referenced file is not in the registry", () => {
    test("returns an 'Unknown file' diagnostic", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        "// ::SPOOL:: <<car.ts#car>>",
        registry,
        templateRegistry,
        "src",
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 27 },
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
        "// ::SPOOL:: <<car.ts#car>>",
        registry,
        templateRegistry,
        "src",
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 27 },
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
        "// ::SPOOL:: <<car.ts#car:bad-modifier>>",
        registry,
        templateRegistry,
        "src",
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 40 },
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
        "// ::SPOOL:: <<car.ts#car:no-expand-nested>>",
        registry,
        templateRegistry,
        "src",
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 44 },
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
        "// ::SPOOL:: <<sadlkj>>",
        registry,
        templateRegistry,
        "src",
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 23 },
          },
          message: "Expected reference to match '::SPOOL:: <<file-path#passage-id>>'",
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
        ["normal text", "// ::SPOOL:: <<car.ts#car>>"].join("\n"),
        registry,
        templateRegistry,
        "src",
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 27 },
          },
          message: "Unknown file: src/car.ts",
          source: "spool",
        },
      ]);
    });
  });
});
