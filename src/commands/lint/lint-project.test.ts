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
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts@START..start(#missing)>>");

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
});
