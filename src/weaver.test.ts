import { test, expect, describe } from "vitest";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { weaveFile, weaveProject } from "./weaver.ts";
import type { PassageRegistry, PassageTemplateRegistry } from "./registries.ts";
import { withTempDir, createFile, makeConfig } from "../tests/helpers.ts";

function makeRegistries(entries: Record<string, { registry: string; template?: string }>): {
  registry: PassageRegistry;
  templateRegistry: PassageTemplateRegistry;
} {
  const registry: PassageRegistry = new Map();
  const templateRegistry: PassageTemplateRegistry = new Map();
  for (const [key, { registry: r, template }] of Object.entries(entries)) {
    registry.set(key, r);
    templateRegistry.set(key, template ?? r);
  }
  return { registry, templateRegistry };
}

describe("weaveFile", () => {
  describe("when the doc contains a reference to a known passage", () => {
    test("replaces that line with the passage content", () => {
      const { registry, templateRegistry } = makeRegistries({
        "src/car.ts:car": { registry: "export class Car {}" },
      });

      const { output, errors } = weaveFile(
        "// ::SPOOL:: <<car.ts#car>>",
        registry,
        templateRegistry,
        "src",
      );

      expect(errors).toEqual([]);
      expect(output).toBe("export class Car {}");
    });
  });

  describe("when the doc contains multiple references", () => {
    test("replaces each line with the corresponding passage content", () => {
      const { registry, templateRegistry } = makeRegistries({
        "src/car.ts:car": { registry: "class Car {}" },
        "src/boat.ts:boat": { registry: "class Boat {}" },
      });

      const doc = [
        "## Car",
        "// ::SPOOL:: <<car.ts#car>>",
        "## Boat",
        "// ::SPOOL:: <<boat.ts#boat>>",
      ].join("\n");

      const { output, errors } = weaveFile(doc, registry, templateRegistry, "src");

      expect(errors).toEqual([]);
      expect(output).toBe(["## Car", "class Car {}", "## Boat", "class Boat {}"].join("\n"));
    });
  });

  describe("when a reference uses the no-expand-nested modifier", () => {
    test("reads the passage from templateRegistry instead of registry", () => {
      const { registry, templateRegistry } = makeRegistries({
        "src/vehicle.ts:outer": {
          registry: "line a\nline b\nline c",
          template: "line a\n// ::SPOOL:: <<src/vehicle.ts#inner>>\nline c",
        },
      });

      const { output, errors } = weaveFile(
        "// ::SPOOL:: <<vehicle.ts#outer:no-expand-nested>>",
        registry,
        templateRegistry,
        "src",
      );

      expect(errors).toEqual([]);
      expect(output).toBe("line a\n// ::SPOOL:: <<src/vehicle.ts#inner>>\nline c");
    });
  });

  describe("when the doc contains a whole-file reference (no passage ID)", () => {
    test("replaces that line with the full file content", () => {
      const { registry, templateRegistry } = makeRegistries({
        "src/cli.ts:": { registry: "const x = 1;\nconst y = 2;" },
      });

      const { output, errors } = weaveFile(
        "// ::SPOOL:: <<cli.ts>>",
        registry,
        templateRegistry,
        "src",
      );

      expect(errors).toEqual([]);
      expect(output).toBe("const x = 1;\nconst y = 2;");
    });

    test("no-expand-nested reads from templateRegistry", () => {
      const { registry, templateRegistry } = makeRegistries({
        "src/cli.ts:": {
          registry: "preamble\nclass Car {}\nepilogue",
          template: "preamble\n// ::SPOOL:: <<src/cli.ts#car>>\nepilogue",
        },
      });

      const { output, errors } = weaveFile(
        "// ::SPOOL:: <<cli.ts:no-expand-nested>>",
        registry,
        templateRegistry,
        "src",
      );

      expect(errors).toEqual([]);
      expect(output).toBe("preamble\n// ::SPOOL:: <<src/cli.ts#car>>\nepilogue");
    });
  });

  describe("when a reference points to an unknown passage", () => {
    test("reports an error and leaves the line unchanged", () => {
      const { registry, templateRegistry } = makeRegistries({});

      const refLine = "// ::SPOOL:: <<car.ts#car>>";
      const { output, errors } = weaveFile(refLine, registry, templateRegistry, "src");

      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("Unknown reference");
      expect(output).toBe(refLine);
    });
  });

  describe("when a reference uses an unknown modifier", () => {
    test("reports an error and skips the replacement", () => {
      const { registry, templateRegistry } = makeRegistries({
        "src/car.ts:car": { registry: "class Car {}" },
      });

      const refLine = "// ::SPOOL:: <<car.ts#car:bad-modifier>>";
      const { output, errors } = weaveFile(refLine, registry, templateRegistry, "src");

      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("Unknown modifier");
      expect(output).toBe(refLine);
    });
  });

  describe("when the doc contains no references", () => {
    test("returns the content unchanged with no errors", () => {
      const { registry, templateRegistry } = makeRegistries({});
      const doc = "# Hello\n\nJust a plain markdown file.\n";

      const { output, errors } = weaveFile(doc, registry, templateRegistry, "src");

      expect(errors).toEqual([]);
      expect(output).toBe(doc);
    });
  });

  describe("when the doc contains a malformed ::SPOOL:: marker", () => {
    test("reports a parse error", () => {
      const { registry, templateRegistry } = makeRegistries({});

      const { errors } = weaveFile("// ::SPOOL::", registry, templateRegistry, "src");

      expect(errors).toHaveLength(1);
    });
  });
});

describe("weaveProject", () => {
  describe("when the docs directory contains markdown files", () => {
    test("writes woven output to the target directory", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "# Guide\n// ::SPOOL:: <<car.ts#car>>");

        await weaveProject(root, makeConfig());

        const result = await readFile(join(root, "out/guide.md"), "utf-8");
        expect(result).toBe("# Guide\nclass Car {}");
      }));

    test("whole-file reference expands to the full file content with passages expanded", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/cli.ts",
          [
            "// ::SPOOL:: start(#setup)",
            "const app = new App();",
            "// ::SPOOL:: end(#setup)",
            "app.run();",
          ].join("\n"),
        );
        await createFile(root, "docs/guide.md", "# Guide\n// ::SPOOL:: <<cli.ts>>");

        await weaveProject(root, makeConfig());

        const result = await readFile(join(root, "out/guide.md"), "utf-8");
        expect(result).toBe("# Guide\nconst app = new App();\napp.run();");
      }));
  });

  describe("when the docs directory contains files in subdirectories", () => {
    test("preserves the relative path structure under the target directory", () =>
      withTempDir(async (root) => {
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/a/b/deep.md", "# Deep");

        await weaveProject(root, makeConfig());

        const result = await readFile(join(root, "out/a/b/deep.md"), "utf-8");
        expect(result).toBe("# Deep");
      }));
  });

  describe("when the docs directory contains non-markdown files", () => {
    test("does not process them", () =>
      withTempDir(async (root) => {
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/notes.txt", "plain text");
        await createFile(root, "docs/guide.md", "# Guide");

        const { filesProcessed } = await weaveProject(root, makeConfig());

        expect(filesProcessed).toBe(1);
      }));
  });

  describe("when multiple markdown files are processed", () => {
    test("returns the correct filesProcessed and filesWritten counts", () =>
      withTempDir(async (root) => {
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/a.md", "# A");
        await createFile(root, "docs/b.md", "# B");
        await createFile(root, "docs/c.md", "# C");

        const { filesProcessed, filesWritten } = await weaveProject(root, makeConfig());

        expect(filesProcessed).toBe(3);
        expect(filesWritten).toBe(3);
      }));
  });

  describe("when source files have malformed annotations", () => {
    test("surfaces registry errors in the result", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/broken.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "# Guide");

        const { registryErrors } = await weaveProject(root, makeConfig());

        expect(registryErrors).toHaveLength(1);
        expect(registryErrors[0]!.filePath).toBe("src/broken.ts");
      }));
  });

  describe("when a doc file references an unknown passage", () => {
    test("surfaces weave errors in the result", () =>
      withTempDir(async (root) => {
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#missing>>");

        const { weaveErrors } = await weaveProject(root, makeConfig());

        expect(weaveErrors).toHaveLength(1);
        expect(weaveErrors[0]!.filePath).toBe("docs/guide.md");
        expect(weaveErrors[0]!.errors[0]!.message).toContain("Unknown reference");
      }));
  });
});
