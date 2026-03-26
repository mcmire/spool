import { test, expect, describe } from "vitest";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DiagnosticSeverity } from "vscode-languageserver/node.js";
import type { Diagnostic } from "vscode-languageserver/node.js";
import { createServerHandlers } from "./server.ts";
import type {
  PassageRegistry,
  PassageTemplateRegistry,
  PassagePositions,
} from "../../registries.ts";
import type { SpoolConfig } from "../../config.ts";
import { makeConfig } from "../../../tests/helpers.ts";

function makeHandlers(
  projectRoot: string,
  configOverrides?: Partial<SpoolConfig["source"]>,
  registry: PassageRegistry = new Map(),
  templateRegistry: PassageTemplateRegistry = new Map(),
  passagePositions: PassagePositions = new Map(),
) {
  const sent: { uri: string; diagnostics: Diagnostic[] }[] = [];
  const handlers = createServerHandlers(
    projectRoot,
    makeConfig(configOverrides),
    registry,
    templateRegistry,
    passagePositions,
    (params: { uri: string; diagnostics: Diagnostic[] }) => sent.push(params),
  );
  return { ...handlers, sent };
}

function fileUri(absolutePath: string): string {
  return pathToFileURL(absolutePath).href;
}

const root = "/project";

describe("createServerHandlers", () => {
  describe("isSourceFile", () => {
    describe("when the file is inside the source directory", () => {
      test("returns true", () => {
        const { isSourceFile } = makeHandlers(root);
        expect(isSourceFile(join(root, "src/car.ts"))).toBe(true);
      });
    });

    describe("when the file is inside a subdirectory of the source directory", () => {
      test("returns true", () => {
        const { isSourceFile } = makeHandlers(root);
        expect(isSourceFile(join(root, "src/a/b/car.ts"))).toBe(true);
      });
    });

    describe("when the file is outside the source directory", () => {
      test("returns false", () => {
        const { isSourceFile } = makeHandlers(root);
        expect(isSourceFile(join(root, "other/car.ts"))).toBe(false);
      });
    });

    describe("when the file is inside the docs directory", () => {
      test("returns false", () => {
        const { isSourceFile } = makeHandlers(root, { code: "src", docs: "src/docs" });
        expect(isSourceFile(join(root, "src/docs/guide.md"))).toBe(false);
      });
    });

    describe("when the file matches an excludeFromCode pattern", () => {
      test("returns false", () => {
        const { isSourceFile } = makeHandlers(root, { excludeFromCode: ["**/*.test.ts"] });
        expect(isSourceFile(join(root, "src/car.test.ts"))).toBe(false);
      });
    });

    describe("when the file is in the source directory and does not match any excludeFromCode pattern", () => {
      test("returns true", () => {
        const { isSourceFile } = makeHandlers(root, { excludeFromCode: ["**/*.test.ts"] });
        expect(isSourceFile(join(root, "src/car.ts"))).toBe(true);
      });
    });
  });

  describe("isDocFile", () => {
    describe("when the file is a markdown file inside the docs directory", () => {
      test("returns true", () => {
        const { isDocFile } = makeHandlers(root);
        expect(isDocFile(join(root, "docs/guide.md"))).toBe(true);
      });
    });

    describe("when the file is inside the docs directory but is not markdown", () => {
      test("returns false", () => {
        const { isDocFile } = makeHandlers(root);
        expect(isDocFile(join(root, "docs/notes.txt"))).toBe(false);
      });
    });

    describe("when the file is a markdown file outside the docs directory", () => {
      test("returns false", () => {
        const { isDocFile } = makeHandlers(root);
        expect(isDocFile(join(root, "src/readme.md"))).toBe(false);
      });
    });
  });

  describe("getDiagnostics", () => {
    describe("when the file is a source file with no annotations", () => {
      test("returns no diagnostics", () => {
        const { getDiagnostics } = makeHandlers(root);
        const diagnostics = getDiagnostics(join(root, "src/car.ts"), "export class Car {}");
        expect(diagnostics).toEqual([]);
      });
    });

    describe("when the file is a source file with a malformed annotation", () => {
      test("returns a diagnostic for the error", () => {
        const { getDiagnostics } = makeHandlers(root);
        const diagnostics = getDiagnostics(join(root, "src/car.ts"), "// ::SPOOL:: foo(#car)");
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]!.severity).toBe(DiagnosticSeverity.Error);
      });
    });

    describe("when the file is a doc file with a known passage reference", () => {
      test("returns no diagnostics", () => {
        const registry: PassageRegistry = new Map([["src/car.ts:car", "class Car {}"]]);
        const { getDiagnostics } = makeHandlers(root, undefined, registry);
        const diagnostics = getDiagnostics(
          join(root, "docs/guide.md"),
          "// ::SPOOL:: <<car.ts#car>>",
        );
        expect(diagnostics).toEqual([]);
      });
    });

    describe("when the file is a doc file with an unknown passage reference", () => {
      test("returns a diagnostic for the unknown reference", () => {
        const { getDiagnostics } = makeHandlers(root);
        const diagnostics = getDiagnostics(
          join(root, "docs/guide.md"),
          "// ::SPOOL:: <<car.ts#missing>>",
        );
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0]!.severity).toBe(DiagnosticSeverity.Error);
      });
    });

    describe("when the file is neither a source file nor a doc file", () => {
      test("returns no diagnostics", () => {
        const { getDiagnostics } = makeHandlers(root);
        const diagnostics = getDiagnostics(join(root, "out/guide.md"), "# Guide");
        expect(diagnostics).toEqual([]);
      });
    });
  });

  describe("validateDocument", () => {
    describe("when called with a source file URI", () => {
      test("sends diagnostics for that URI", () => {
        const { validateDocument, sent } = makeHandlers(root);
        const uri = fileUri(join(root, "src/car.ts"));
        validateDocument(uri, "export class Car {}");
        expect(sent).toHaveLength(1);
        expect(sent[0]!.uri).toBe(uri);
      });
    });

    describe("when the source file has a malformed annotation", () => {
      test("sends a diagnostic with error severity", () => {
        const { validateDocument, sent } = makeHandlers(root);
        validateDocument(fileUri(join(root, "src/car.ts")), "// ::SPOOL:: foo(#car)");
        expect(sent[0]!.diagnostics).toHaveLength(1);
        expect(sent[0]!.diagnostics[0]!.severity).toBe(DiagnosticSeverity.Error);
      });
    });

    describe("when called with an invalid URI", () => {
      test("does not send diagnostics", () => {
        const { validateDocument, sent } = makeHandlers(root);
        validateDocument("not-a-valid-uri", "content");
        expect(sent).toHaveLength(0);
      });
    });
  });
});
