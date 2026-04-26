import { test, expect, describe } from "vitest";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { lintCommand } from "./command.ts";
import { withTempDir, createFile, writeConfig, makeWritable } from "../../../tests/helpers.ts";

describe("lintCommand", () => {
  describe("when there are no errors", () => {
    test("writes a success message to stdout and nothing to stderr", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#car>>");

        const stdout = makeWritable();
        const stderr = makeWritable();
        await lintCommand({ cwd: root, stdout, stderr });

        expect(stdout.output).toBe("No errors found.\n");
        expect(stderr.output).toBe("");
      }));

    test("returns no exitCode", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const { exitCode } = await lintCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
        });

        expect(exitCode).toBeUndefined();
      }));
  });

  describe("when a doc file references an unknown passage", () => {
    test("writes the passage reference errors section to stderr", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#missing>>");

        const stderr = makeWritable();
        await lintCommand({ cwd: root, stdout: makeWritable(), stderr });

        expect(stderr.output).toBe(
          "Passage reference errors:\n" +
            "  docs/guide.md:1:4: Unknown reference: ::SPOOL:: <<src/car.ts#missing>>\n",
        );
      }));

    test("returns exitCode 1", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#missing>>");

        const { exitCode } = await lintCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
        });

        expect(exitCode).toBe(1);
      }));
  });

  describe("when a source file has malformed annotations", () => {
    test("writes the source file errors section to stderr", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(
          root,
          "src/broken.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "# Guide");

        const stderr = makeWritable();
        await lintCommand({ cwd: root, stdout: makeWritable(), stderr });

        expect(stderr.output).toBe(
          "Source file errors:\n" + '  src/broken.ts:1:1: Unclosed passage "car"\n',
        );
      }));

    test("returns exitCode 1", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(
          root,
          "src/broken.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "# Guide");

        const { exitCode } = await lintCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
        });

        expect(exitCode).toBe(1);
      }));
  });

  describe("when there are both registry errors and doc errors", () => {
    test("writes both error sections to stderr", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(
          root,
          "src/broken.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#missing>>");

        const stderr = makeWritable();
        await lintCommand({ cwd: root, stdout: makeWritable(), stderr });

        expect(stderr.output).toBe(
          "Source file errors:\n" +
            '  src/broken.ts:1:1: Unclosed passage "car"\n' +
            "Passage reference errors:\n" +
            "  docs/guide.md:1:4: Unknown reference: ::SPOOL:: <<src/car.ts#missing>>\n",
        );
      }));
  });

  describe("--coverage", () => {
    describe("when a source file has no markers", () => {
      test("writes the unmarked source files section to stderr", () =>
        withTempDir(async (root) => {
          await writeConfig(root);
          await createFile(root, "src/utils.ts", "export function noop() {}");
          await createFile(root, "docs/guide.md", "# Guide");

          const stderr = makeWritable();
          await lintCommand({ cwd: root, stdout: makeWritable(), stderr, coverage: true });

          expect(stderr.output).toBe("Unmarked source files:\n  src/utils.ts\n");
        }));

      test("returns exitCode 1", () =>
        withTempDir(async (root) => {
          await writeConfig(root);
          await createFile(root, "src/utils.ts", "export function noop() {}");
          await createFile(root, "docs/guide.md", "# Guide");

          const { exitCode } = await lintCommand({
            cwd: root,
            stdout: makeWritable(),
            stderr: makeWritable(),
            coverage: true,
          });

          expect(exitCode).toBe(1);
        }));
    });

    describe("when a passage is not referenced in any doc", () => {
      test("writes the unreferenced passages section to stderr", () =>
        withTempDir(async (root) => {
          await writeConfig(root);
          await createFile(
            root,
            "src/car.ts",
            ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
          );
          await createFile(root, "docs/guide.md", "# Guide");

          const stderr = makeWritable();
          await lintCommand({ cwd: root, stdout: makeWritable(), stderr, coverage: true });

          expect(stderr.output).toBe("Unreferenced passages:\n  src/car.ts#car\n");
        }));

      test("returns exitCode 1", () =>
        withTempDir(async (root) => {
          await writeConfig(root);
          await createFile(
            root,
            "src/car.ts",
            ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
          );
          await createFile(root, "docs/guide.md", "# Guide");

          const { exitCode } = await lintCommand({
            cwd: root,
            stdout: makeWritable(),
            stderr: makeWritable(),
            coverage: true,
          });

          expect(exitCode).toBe(1);
        }));
    });

    describe("when all files are marked and all passages are referenced", () => {
      test("writes a success message and returns no exitCode", () =>
        withTempDir(async (root) => {
          await writeConfig(root);
          await createFile(
            root,
            "src/car.ts",
            ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
          );
          await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#car>>");

          const stdout = makeWritable();
          const { exitCode } = await lintCommand({
            cwd: root,
            stdout,
            stderr: makeWritable(),
            coverage: true,
          });

          expect(stdout.output).toBe("No errors found.\n");
          expect(exitCode).toBeUndefined();
        }));
    });
  });
});
