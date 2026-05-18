import { test, expect, describe } from "vitest";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { withTempDir, createFile, writeConfig } from "../../../tests/helpers.ts";
import type {
  PassageRegistry,
  PassageTemplateRegistry,
  PassagePositions,
} from "../../registries.ts";
import type { PassageLocationMap } from "./reference-map.ts";
import { inferLang, weaveSiteFile, weaveSiteFiles } from "./weave-site.ts";

function makeRegistries(
  entries: Record<string, { registry: string; template?: string }>,
  positions?: PassagePositions,
): {
  registry: PassageRegistry;
  templateRegistry: PassageTemplateRegistry;
  passagePositions: PassagePositions;
} {
  const registry: PassageRegistry = new Map();
  const templateRegistry: PassageTemplateRegistry = new Map();
  const passagePositions: PassagePositions = positions ?? new Map();
  for (const [key, { registry: r, template }] of Object.entries(entries)) {
    registry.set(key, r);
    templateRegistry.set(key, template ?? r);
  }
  return { registry, templateRegistry, passagePositions };
}

describe("inferLang", () => {
  describe("when the file has a known extension", () => {
    test("returns the mapped language", () => {
      expect(inferLang("foo.ts")).toBe("ts");
      expect(inferLang("bar.py")).toBe("python");
      expect(inferLang("baz.rs")).toBe("rust");
    });
  });

  describe("when the file has an unknown extension", () => {
    test("returns the extension without the dot", () => {
      expect(inferLang("foo.xyz")).toBe("xyz");
    });
  });

  describe("when the extension has mixed case", () => {
    test("lowercases before lookup", () => {
      expect(inferLang("foo.TS")).toBe("ts");
    });
  });
});

describe("weaveSiteFile", () => {
  describe("when the doc contains a passage reference", () => {
    test("wraps the passage in a SpoolPassage component with a code fence", () => {
      const { registry, templateRegistry, passagePositions } = makeRegistries({
        "src/car.ts:drive": { registry: "export function drive() {}" },
      });

      const { output, errors } = weaveSiteFile(
        "// ::SPOOL:: <<src/car.ts#drive>>",
        registry,
        templateRegistry,
        passagePositions,
        undefined,
      );

      expect(errors).toEqual([]);
      expect(output).toBe(
        "<SpoolPassage>\n\n```ts\nexport function drive() {}\n```\n\n</SpoolPassage>",
      );
    });
  });

  describe("when a passage location map is provided", () => {
    test("includes the anchor attribute on the SpoolPassage component", () => {
      const { registry, templateRegistry, passagePositions } = makeRegistries({
        "src/car.ts:drive": { registry: "export function drive() {}" },
      });

      const locationMap: PassageLocationMap = new Map([
        [
          "src/car.ts:drive",
          {
            docPath: "guide.md",
            anchorId: "spool-src-car-ts-drive",
            url: "/guide.html#spool-src-car-ts-drive",
          },
        ],
      ]);

      const { output, errors } = weaveSiteFile(
        "// ::SPOOL:: <<src/car.ts#drive>>",
        registry,
        templateRegistry,
        passagePositions,
        locationMap,
      );

      expect(errors).toEqual([]);
      expect(output).toContain('anchor="spool-src-car-ts-drive"');
    });
  });

  describe("when the doc contains a whole-file reference", () => {
    test("wraps the whole file content with the correct language", () => {
      const { registry, templateRegistry, passagePositions } = makeRegistries({
        "src/style.css:": { registry: "body { margin: 0; }" },
      });

      const { output } = weaveSiteFile(
        "::SPOOL:: <<src/style.css>>",
        registry,
        templateRegistry,
        passagePositions,
        undefined,
      );

      expect(output).toContain("```css");
      expect(output).toContain("body { margin: 0; }");
    });
  });

  describe("when the doc contains a no-expand-nested reference", () => {
    test("uses the template registry content", () => {
      const { registry, templateRegistry, passagePositions } = makeRegistries({
        "src/cli.ts:": {
          registry: "const program = new Command();\nprogram.command('lint')...",
          template: "const program = new Command();\n// ::SPOOL:: <<src/cli.ts#lint>>",
        },
      });

      const { output } = weaveSiteFile(
        "::SPOOL:: <<src/cli.ts:no-expand-nested>>",
        registry,
        templateRegistry,
        passagePositions,
        undefined,
      );

      expect(output).toContain("// ::SPOOL:: <<src/cli.ts#lint>>");
    });
  });

  describe("when the doc contains an unknown reference", () => {
    test("reports an error", () => {
      const { registry, templateRegistry, passagePositions } = makeRegistries({});

      const { errors } = weaveSiteFile(
        "::SPOOL:: <<src/missing.ts#foo>>",
        registry,
        templateRegistry,
        passagePositions,
        undefined,
      );

      expect(errors.length).toBe(1);
      expect(errors[0]!.message).toContain("Unknown reference");
    });
  });

  describe("when the reference is wrapped in a doc code fence", () => {
    test("strips the surrounding fence delimiters", () => {
      const { registry, templateRegistry, passagePositions } = makeRegistries({
        "src/car.ts:drive": { registry: "export function drive() {}" },
      });

      const { output, errors } = weaveSiteFile(
        "```ts\n// ::SPOOL:: <<src/car.ts#drive>>\n```",
        registry,
        templateRegistry,
        passagePositions,
        undefined,
      );

      expect(errors).toEqual([]);
      // The outer doc fences should be gone; the inner fence inside the component is fine
      expect(output).not.toMatch(/^```ts\s*$\n.*<SpoolPassage>/ms);
      expect(output).not.toMatch(/<\/SpoolPassage>\n```\s*$/ms);
      expect(output).toContain("<SpoolPassage>");
      expect(output).toContain("```ts\nexport function drive() {}");
    });
  });

  describe("when the doc mixes prose and references", () => {
    test("preserves non-reference lines unchanged", () => {
      const { registry, templateRegistry, passagePositions } = makeRegistries({
        "src/car.ts:drive": { registry: "export function drive() {}" },
      });

      const { output } = weaveSiteFile(
        "# Guide\n\nHere is the code:\n\n// ::SPOOL:: <<src/car.ts#drive>>",
        registry,
        templateRegistry,
        passagePositions,
        undefined,
      );

      expect(output).toMatch(/^# Guide\n\nHere is the code:\n\n<SpoolPassage>/);
    });
  });
});

describe("weaveSiteFiles", () => {
  describe("when called with a simple project", () => {
    test("returns woven files with SpoolPassage wrappers", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(root, "src/car.ts", "export function drive() {}");
        await createFile(root, "docs/guide.md", "# Guide\n\n::SPOOL:: <<src/car.ts>>");

        const result = await weaveSiteFiles(root, {
          source: { code: "src", docs: "docs" },
          target: "out",
        });

        expect(result.filesProcessed).toBe(1);
        expect(result.files.size).toBe(1);
        const content = result.files.get("guide.mdx")!;
        expect(content).toContain("<SpoolPassage>");
        expect(content).toContain("export function drive() {}");
      }));
  });

  describe("when verifyUniqueReferences is set and references are unique", () => {
    test("returns no reference errors", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(root, "src/car.ts", "export function drive() {}");
        await createFile(root, "docs/guide.md", "::SPOOL:: <<src/car.ts>>");

        const result = await weaveSiteFiles(
          root,
          { source: { code: "src", docs: "docs" }, target: "out" },
          { verifyUniqueReferences: true },
        );

        expect(result.referenceErrors).toEqual([]);
      }));
  });

  describe("when verifyUniqueReferences is set and a passage is on multiple pages", () => {
    test("returns reference errors", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(root, "src/car.ts", "export function drive() {}");
        await createFile(root, "docs/page1.md", "::SPOOL:: <<src/car.ts>>");
        await createFile(root, "docs/page2.md", "::SPOOL:: <<src/car.ts>>");

        const result = await weaveSiteFiles(
          root,
          { source: { code: "src", docs: "docs" }, target: "out" },
          { verifyUniqueReferences: true },
        );

        expect(result.referenceErrors.length).toBeGreaterThan(0);
        expect(result.referenceErrors[0]!.errors[0]!.message).toContain("multiple pages");
      }));
  });

  describe("when linkReferences is set", () => {
    test("includes anchor attributes in SpoolPassage wrappers", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(root, "src/car.ts", "export function drive() {}");
        await createFile(root, "docs/guide.md", "::SPOOL:: <<src/car.ts>>");

        const result = await weaveSiteFiles(
          root,
          { source: { code: "src", docs: "docs" }, target: "out" },
          { linkReferences: true },
        );

        const content = result.files.get("guide.mdx")!;
        expect(content).toContain('anchor="spool-src-car-ts"');
      }));

    test("returns the passage location map", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(root, "src/car.ts", "export function drive() {}");
        await createFile(root, "docs/guide.md", "::SPOOL:: <<src/car.ts>>");

        const result = await weaveSiteFiles(
          root,
          { source: { code: "src", docs: "docs" }, target: "out" },
          { linkReferences: true },
        );

        const info = result.passageLocationMap.get("src/car.ts:");
        expect(info).toBeDefined();
        expect(info!.url).toBe("/guide#spool-src-car-ts");
      }));
  });
});
