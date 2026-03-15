import { test, expect, describe } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildRegistries } from "./registries.ts";
import type { SpoolConfig } from "./config.ts";
import { withTempDir } from "../tests/helpers.ts";

async function createFile(dir: string, relPath: string, content: string): Promise<void> {
  const fullPath = join(dir, relPath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

function makeConfig(overrides?: Partial<SpoolConfig["source"]>): SpoolConfig {
  return {
    source: {
      code: "src",
      docs: "docs",
      ...overrides,
    },
    target: "out",
  };
}

describe("buildRegistries", () => {
  describe("when a source file has annotated passages", () => {
    test("adds each passage to the registry and templateRegistry", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.ts",
          [
            "// ::SPOOL:: start(#car)",
            "export class Car {}",
            "// ::SPOOL:: end(#car)",
          ].join("\n"),
        );

        const { registry, templateRegistry, errors } = await buildRegistries(root, makeConfig());

        expect(errors).toEqual([]);
        expect(registry.get("src/car.ts:car")).toBe("export class Car {}");
        expect(templateRegistry.get("src/car.ts:car")).toBe("export class Car {}");
      }));

    test("registry and templateRegistry have identical keys", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );

        const { registry, templateRegistry } = await buildRegistries(root, makeConfig());

        expect([...registry.keys()].sort()).toEqual([...templateRegistry.keys()].sort());
      }));
  });

  describe("when a source file has multiple annotated passages", () => {
    test("adds all passages to the registry", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/vehicles.ts",
          [
            "// ::SPOOL:: start(#car)",
            "class Car {}",
            "// ::SPOOL:: end(#car)",
            "// ::SPOOL:: start(#boat)",
            "class Boat {}",
            "// ::SPOOL:: end(#boat)",
          ].join("\n"),
        );

        const { registry, errors } = await buildRegistries(root, makeConfig());

        expect(errors).toEqual([]);
        expect(registry.get("src/vehicles.ts:car")).toBe("class Car {}");
        expect(registry.get("src/vehicles.ts:boat")).toBe("class Boat {}");
      }));
  });

  describe("when multiple source files have annotated passages", () => {
    test("adds passages from all files to the registry", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );
        await createFile(
          root,
          "src/boat.ts",
          ["// ::SPOOL:: start(#boat)", "class Boat {}", "// ::SPOOL:: end(#boat)"].join("\n"),
        );

        const { registry, errors } = await buildRegistries(root, makeConfig());

        expect(errors).toEqual([]);
        expect(registry.get("src/car.ts:car")).toBe("class Car {}");
        expect(registry.get("src/boat.ts:boat")).toBe("class Boat {}");
      }));
  });

  describe("when no files have annotated passages", () => {
    test("returns empty registries", () =>
      withTempDir(async (root) => {
        await createFile(root, "src/plain.ts", "export const x = 1;\n");

        const { registry, templateRegistry, errors } = await buildRegistries(root, makeConfig());

        expect(errors).toEqual([]);
        expect(registry.size).toBe(0);
        expect(templateRegistry.size).toBe(0);
      }));
  });

  describe("when a file is inside the docs directory", () => {
    test("excludes it from the registry", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/docs/guide.ts",
          ["// ::SPOOL:: start(#guide)", "guide content", "// ::SPOOL:: end(#guide)"].join("\n"),
        );
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );

        const config: SpoolConfig = {
          source: { code: "src", docs: "src/docs" },
          target: "out",
        };

        const { registry, errors } = await buildRegistries(root, config);

        expect(errors).toEqual([]);
        expect(registry.has("src/docs/guide.ts:guide")).toBe(false);
        expect(registry.get("src/car.ts:car")).toBe("class Car {}");
      }));
  });

  describe("when a file matches an excludeFromCode pattern", () => {
    test("excludes it from the registry", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.test.ts",
          ["// ::SPOOL:: start(#car-test)", "test content", "// ::SPOOL:: end(#car-test)"].join(
            "\n",
          ),
        );
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );

        const config = makeConfig({ excludeFromCode: ["**/*.test.ts"] });

        const { registry, errors } = await buildRegistries(root, config);

        expect(errors).toEqual([]);
        expect(registry.has("src/car.test.ts:car-test")).toBe(false);
        expect(registry.get("src/car.ts:car")).toBe("class Car {}");
      }));
  });

  describe("when multiple excludeFromCode patterns are configured", () => {
    test("excludes files matching any of them", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.spec.ts",
          ["// ::SPOOL:: start(#spec)", "spec content", "// ::SPOOL:: end(#spec)"].join("\n"),
        );
        await createFile(
          root,
          "src/car.test.ts",
          ["// ::SPOOL:: start(#test)", "test content", "// ::SPOOL:: end(#test)"].join("\n"),
        );
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );

        const config = makeConfig({ excludeFromCode: ["**/*.test.ts", "**/*.spec.ts"] });

        const { registry, errors } = await buildRegistries(root, config);

        expect(errors).toEqual([]);
        expect(registry.has("src/car.test.ts:test")).toBe(false);
        expect(registry.has("src/car.spec.ts:spec")).toBe(false);
        expect(registry.get("src/car.ts:car")).toBe("class Car {}");
      }));
  });

  describe("when excludeFromCode is not configured", () => {
    test("includes all source files", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.test.ts",
          ["// ::SPOOL:: start(#car-test)", "test content", "// ::SPOOL:: end(#car-test)"].join(
            "\n",
          ),
        );

        const { registry } = await buildRegistries(root, makeConfig());

        expect(registry.has("src/car.test.ts:car-test")).toBe(true);
      }));
  });

  describe("when a file contains a null byte", () => {
    test("skips it silently", () =>
      withTempDir(async (root) => {
        const binaryContent = "some text\x00binary data";
        await mkdir(join(root, "src"), { recursive: true });
        await writeFile(join(root, "src/binary.bin"), binaryContent, "utf-8");

        const { registry, errors } = await buildRegistries(root, makeConfig());

        expect(errors).toEqual([]);
        expect(registry.size).toBe(0);
      }));
  });

  describe("when a source file has malformed annotations", () => {
    test("reports errors attributed to that file", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/broken.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}"].join("\n"),
        );

        const { errors } = await buildRegistries(root, makeConfig());

        expect(errors).toHaveLength(1);
        const fileError = errors[0]!;
        expect(fileError.filePath).toBe("src/broken.ts");
        expect(fileError.errors.length).toBeGreaterThan(0);
      }));
  });

  describe("when multiple source files have malformed annotations", () => {
    test("reports errors for each file independently", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/a.ts",
          ["// ::SPOOL:: start(#a)", "class A {}"].join("\n"),
        );
        await createFile(
          root,
          "src/b.ts",
          ["// ::SPOOL:: start(#b)", "class B {}"].join("\n"),
        );

        const { errors } = await buildRegistries(root, makeConfig());

        expect(errors).toHaveLength(2);
        const filePaths = errors.map((e) => e.filePath).sort();
        expect(filePaths).toEqual(["src/a.ts", "src/b.ts"]);
      }));
  });

  describe("when a passage has no nested passages", () => {
    test("templateRegistry stores the raw passage content", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );

        const { registry, templateRegistry } = await buildRegistries(root, makeConfig());

        expect(templateRegistry.get("src/car.ts:car")).toBe(registry.get("src/car.ts:car"));
      }));
  });

  describe("when a passage contains nested passages", () => {
    test("templateRegistry replaces the nested block with a ::SPOOL:: reference", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/vehicle.ts",
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

        const { registry, templateRegistry, errors } = await buildRegistries(root, makeConfig());

        expect(errors).toEqual([]);
        expect(registry.get("src/vehicle.ts:inner")).toBe("line b");
        expect(templateRegistry.get("src/vehicle.ts:inner")).toBe("line b");
        expect(registry.get("src/vehicle.ts:outer")).toBe("line a\nline b\nline c");

        const outerTemplate = templateRegistry.get("src/vehicle.ts:outer");
        expect(outerTemplate).toContain("::SPOOL:: <<src/vehicle.ts#inner>>");
        expect(outerTemplate).toContain("line a");
        expect(outerTemplate).toContain("line c");
        expect(outerTemplate).not.toContain("line b");
      }));

    test("templateRegistry preserves the comment prefix on the ::SPOOL:: reference line", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/vehicle.ts",
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

        const { templateRegistry } = await buildRegistries(root, makeConfig());

        const outerTemplate = templateRegistry.get("src/vehicle.ts:outer") ?? "";
        expect(outerTemplate).toMatch(/^\/\/ ::SPOOL:: <<src\/vehicle\.ts#inner>>/m);
      }));
  });

  describe("when source files are in nested subdirectories", () => {
    test("finds and registers their passages", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/a/b/deep.ts",
          ["// ::SPOOL:: start(#deep)", "deep content", "// ::SPOOL:: end(#deep)"].join("\n"),
        );

        const { registry, errors } = await buildRegistries(root, makeConfig());

        expect(errors).toEqual([]);
        expect(registry.get("src/a/b/deep.ts:deep")).toBe("deep content");
      }));
  });
});
