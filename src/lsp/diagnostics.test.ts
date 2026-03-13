import { test, expect, describe } from "bun:test";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";
import { getSourceFileDiagnostics, getDocFileDiagnostics } from "./diagnostics.ts";
import type { PassageRegistry, PassageTemplateRegistry } from "../registries.ts";

describe("getSourceFileDiagnostics", () => {
  describe("valid source", () => {
    test("no annotations returns no diagnostics", () => {
      const diagnostics = getSourceFileDiagnostics("just normal code\nmore code");
      expect(diagnostics).toEqual([]);
    });

    test("valid passage returns no diagnostics", () => {
      const diagnostics = getSourceFileDiagnostics(
        ["// @SPOOL(start): #car", "export class Car {}", "// @SPOOL(end): #car"].join("\n"),
      );
      expect(diagnostics).toEqual([]);
    });
  });

  describe("invalid source", () => {
    test("malformed annotation produces diagnostic with correct range", () => {
      const diagnostics = getSourceFileDiagnostics(["// @SPOOL(foo): #car"].join("\n"));
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 14 },
          },
          message: "Expected directive 'start' or 'end', got 'foo'",
          source: "spool",
        },
      ]);
    });

    test("unclosed passage produces diagnostic with zero-length range", () => {
      const diagnostics = getSourceFileDiagnostics(["// @SPOOL(start): #car", "code"].join("\n"));
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

    test("error on second line has correct line index", () => {
      const diagnostics = getSourceFileDiagnostics(
        ["normal code", "// @SPOOL(bad): #car"].join("\n"),
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 14 },
          },
          message: "Expected directive 'start' or 'end', got 'bad'",
          source: "spool",
        },
      ]);
    });
  });
});

describe("getDocFileDiagnostics", () => {
  describe("valid references", () => {
    test("reference found in registry returns no diagnostics", () => {
      const registry: PassageRegistry = new Map([["src/car.ts:car", "export class Car {}"]]);
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        ["// <<@SPOOL: src/car.ts#car>>"].join("\n"),
        registry,
        templateRegistry,
      );
      expect(diagnostics).toEqual([]);
    });

    test("no-expand-nested found in templateRegistry returns no diagnostics", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map([["src/car.ts:car", "code"]]);
      const diagnostics = getDocFileDiagnostics(
        ["// <<@SPOOL: src/car.ts#car:no-expand-nested>>"].join("\n"),
        registry,
        templateRegistry,
      );
      expect(diagnostics).toEqual([]);
    });
  });

  describe("invalid references", () => {
    test("reference not found in registry produces diagnostic", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        ["// <<@SPOOL: src/car.ts#car>>"].join("\n"),
        registry,
        templateRegistry,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 29 },
          },
          message: "Unknown reference: <<@SPOOL: src/car.ts#car>>",
          source: "spool",
        },
      ]);
    });

    test("unknown modifier produces diagnostic", () => {
      const registry: PassageRegistry = new Map([["src/car.ts:car", "code"]]);
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        ["// <<@SPOOL: src/car.ts#car:bad-modifier>>"].join("\n"),
        registry,
        templateRegistry,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 42 },
          },
          message: "Unknown modifier: bad-modifier",
          source: "spool",
        },
      ]);
    });

    test("no-expand-nested not found in templateRegistry produces diagnostic", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        ["// <<@SPOOL: src/car.ts#car:no-expand-nested>>"].join("\n"),
        registry,
        templateRegistry,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 46 },
          },
          message: "Unknown reference: <<@SPOOL: src/car.ts#car:no-expand-nested>>",
          source: "spool",
        },
      ]);
    });

    test("malformed reference produces diagnostic", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        ["// <<@SPOOL: sadlkj>>"].join("\n"),
        registry,
        templateRegistry,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 0, character: 3 },
            end: { line: 0, character: 21 },
          },
          message: "Expected reference to match '@SPOOL: file-path#passage-id'",
          source: "spool",
        },
      ]);
    });

    test("reference on second line has correct line index", () => {
      const registry: PassageRegistry = new Map();
      const templateRegistry: PassageTemplateRegistry = new Map();
      const diagnostics = getDocFileDiagnostics(
        ["normal text", "// <<@SPOOL: src/car.ts#car>>"].join("\n"),
        registry,
        templateRegistry,
      );
      expect(diagnostics).toEqual([
        {
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 29 },
          },
          message: "Unknown reference: <<@SPOOL: src/car.ts#car>>",
          source: "spool",
        },
      ]);
    });
  });
});
