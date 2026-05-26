import { test, expect, describe } from "vitest";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { lintProject } from "./lint-project.ts";
import { withTempDir, createFile, makeConfig } from "../../../tests/helpers.ts";

describe("lintProject", () => {
  describe("when all references in doc files resolve to known passages", () => {
    test("returns no errors", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#car>>");

        const { registryErrors, docErrors } = await lintProject(root, makeConfig());

        expect(registryErrors).toEqual([]);
        expect(docErrors).toEqual([]);
      }));
  });

  describe("when a doc file references an unknown passage", () => {
    test("reports a doc error for that file", () =>
      withTempDir(async (root) => {
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#missing>>");

        const { docErrors } = await lintProject(root, makeConfig());

        expect(docErrors).toHaveLength(1);
        expect(docErrors[0]!.filePath).toBe("docs/guide.md");
        expect(docErrors[0]!.errors[0]!.message).toContain("Unknown reference");
      }));
  });

  describe("when multiple doc files contain unknown references", () => {
    test("reports doc errors for each file independently", () =>
      withTempDir(async (root) => {
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/a.md", "// ::SPOOL:: <<src/car.ts#missing-a>>");
        await createFile(root, "docs/b.md", "// ::SPOOL:: <<src/car.ts#missing-b>>");

        const { docErrors } = await lintProject(root, makeConfig());

        expect(docErrors).toHaveLength(2);
        const filePaths = docErrors.map((e) => e.filePath).sort();
        expect(filePaths).toEqual(["docs/a.md", "docs/b.md"]);
      }));
  });

  describe("when a source file has malformed annotations", () => {
    test("reports registry errors for that file", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/broken.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "# Guide");

        const { registryErrors } = await lintProject(root, makeConfig());

        expect(registryErrors).toHaveLength(1);
        expect(registryErrors[0]!.filePath).toBe("src/broken.ts");
      }));
  });

  describe("when the docs directory contains non-markdown files", () => {
    test("does not lint them", () =>
      withTempDir(async (root) => {
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/notes.txt", "// ::SPOOL:: <<src/car.ts#missing>>");

        const { docErrors } = await lintProject(root, makeConfig());

        expect(docErrors).toEqual([]);
      }));
  });

  describe("when a doc file uses a valid range reference", () => {
    test("returns no errors", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts@START..start(#car)>>");

        const { registryErrors, docErrors } = await lintProject(root, makeConfig());

        expect(registryErrors).toEqual([]);
        expect(docErrors).toEqual([]);
      }));
  });

  describe("when a doc file uses a range reference pointing to an unknown file", () => {
    test("reports a doc error for that file", () =>
      withTempDir(async (root) => {
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/missing.ts@START..END>>");

        const { docErrors } = await lintProject(root, makeConfig());

        expect(docErrors).toHaveLength(1);
        expect(docErrors[0]!.filePath).toBe("docs/guide.md");
        expect(docErrors[0]!.errors[0]!.message).toContain("Unknown reference");
      }));
  });

  describe("when a doc file uses a range reference with an unknown named passage marker", () => {
    test("reports a doc error for that file", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );
        await createFile(
          root,
          "docs/guide.md",
          "// ::SPOOL:: <<src/car.ts@START..start(#missing)>>",
        );

        const { docErrors } = await lintProject(root, makeConfig());

        expect(docErrors).toHaveLength(1);
        expect(docErrors[0]!.filePath).toBe("docs/guide.md");
        expect(docErrors[0]!.errors[0]!.message).toContain("Unknown passage in range");
      }));
  });

  describe("when a doc file references a passage from a file excluded by excludeFromCode", () => {
    test("reports a doc error because the passage is not in the registry", () =>
      withTempDir(async (root) => {
        await createFile(
          root,
          "src/car.test.ts",
          ["// ::SPOOL:: start(#car-test)", "test content", "// ::SPOOL:: end(#car-test)"].join(
            "\n",
          ),
        );
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.test.ts#car-test>>");

        const config = makeConfig({ excludeFromCode: ["**/*.test.ts"] });
        const { docErrors } = await lintProject(root, config);

        expect(docErrors).toHaveLength(1);
        expect(docErrors[0]!.errors[0]!.message).toContain("Unknown reference");
      }));
  });

  describe("coverage mode", () => {
    describe("when all files are marked and all passages are referenced", () => {
      test("returns empty unmarkedFiles and unreferencedPassages", () =>
        withTempDir(async (root) => {
          await createFile(
            root,
            "src/car.ts",
            ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
          );
          await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#car>>");

          const { unmarkedFiles, unreferencedPassages } = await lintProject(root, makeConfig(), {
            coverage: true,
          });

          expect(unmarkedFiles).toEqual([]);
          expect(unreferencedPassages).toEqual([]);
        }));
    });

    describe("when a source file has no markers", () => {
      test("includes it in unmarkedFiles", () =>
        withTempDir(async (root) => {
          await createFile(root, "src/utils.ts", "export function noop() {}");
          await createFile(root, "docs/guide.md", "# Guide");

          const { unmarkedFiles } = await lintProject(root, makeConfig(), { coverage: true });

          expect(unmarkedFiles).toEqual(["src/utils.ts"]);
        }));
    });

    describe("when a passage is defined but not referenced in any doc", () => {
      test("includes it in unreferencedPassages", () =>
        withTempDir(async (root) => {
          await createFile(
            root,
            "src/car.ts",
            ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
          );
          await createFile(root, "docs/guide.md", "# Guide");

          const { unreferencedPassages } = await lintProject(root, makeConfig(), {
            coverage: true,
          });

          expect(unreferencedPassages).toEqual([{ filePath: "src/car.ts", passageName: "car" }]);
        }));
    });

    describe("when a passage is only referenced via a range ref", () => {
      test("still considers the passage unreferenced", () =>
        withTempDir(async (root) => {
          await createFile(
            root,
            "src/car.ts",
            ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
          );
          await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts@START..end(#car)>>");

          const { unreferencedPassages } = await lintProject(root, makeConfig(), {
            coverage: true,
          });

          expect(unreferencedPassages).toEqual([{ filePath: "src/car.ts", passageName: "car" }]);
        }));
    });

    describe("when a source file with no markers is referenced whole-file in a doc", () => {
      test("does not include it in unmarkedFiles", () =>
        withTempDir(async (root) => {
          await createFile(root, "src/utils.ts", "export function noop() {}");
          await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/utils.ts>>");

          const { unmarkedFiles } = await lintProject(root, makeConfig(), { coverage: true });

          expect(unmarkedFiles).toEqual([]);
        }));
    });

    describe("when a source file with passages is referenced whole-file in a doc", () => {
      test("does not include its passages in unreferencedPassages", () =>
        withTempDir(async (root) => {
          await createFile(
            root,
            "src/car.ts",
            ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
          );
          await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts>>");

          const { unreferencedPassages } = await lintProject(root, makeConfig(), {
            coverage: true,
          });

          expect(unreferencedPassages).toEqual([]);
        }));
    });

    describe("when a source file matches excludeFromCode and has no markers", () => {
      test("does not include it in unmarkedFiles", () =>
        withTempDir(async (root) => {
          await createFile(root, "src/utils.test.ts", "export function noop() {}");
          await createFile(root, "docs/guide.md", "# Guide");

          const config = makeConfig({ excludeFromCode: ["**/*.test.ts"] });
          const { unmarkedFiles } = await lintProject(root, config, { coverage: true });

          expect(unmarkedFiles).toEqual([]);
        }));
    });

    describe("when a source file matches excludeFromCode and has passages", () => {
      test("does not include its passages in unreferencedPassages", () =>
        withTempDir(async (root) => {
          await createFile(
            root,
            "src/car.test.ts",
            ["// ::SPOOL:: start(#car-test)", "test content", "// ::SPOOL:: end(#car-test)"].join(
              "\n",
            ),
          );
          await createFile(root, "docs/guide.md", "# Guide");

          const config = makeConfig({ excludeFromCode: ["**/*.test.ts"] });
          const { unreferencedPassages } = await lintProject(root, config, { coverage: true });

          expect(unreferencedPassages).toEqual([]);
        }));
    });

    describe("when coverage is not enabled", () => {
      test("does not return unmarkedFiles or unreferencedPassages", () =>
        withTempDir(async (root) => {
          await createFile(root, "src/utils.ts", "export function noop() {}");
          await createFile(root, "docs/guide.md", "# Guide");

          const result = await lintProject(root, makeConfig());

          expect(result.unmarkedFiles).toBeUndefined();
          expect(result.unreferencedPassages).toBeUndefined();
        }));
    });
  });
});
