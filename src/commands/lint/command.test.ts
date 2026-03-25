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
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#car>>");

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
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#missing>>");

        const stderr = makeWritable();
        await lintCommand({ cwd: root, stdout: makeWritable(), stderr });

        expect(stderr.output).toBe(
          "Passage reference errors:\n" +
            "  docs/guide.md:1:4: Unknown reference: ::SPOOL:: <<car.ts#missing>>\n",
        );
      }));

    test("returns exitCode 1", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#missing>>");

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
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#missing>>");

        const stderr = makeWritable();
        await lintCommand({ cwd: root, stdout: makeWritable(), stderr });

        expect(stderr.output).toBe(
          "Source file errors:\n" +
            '  src/broken.ts:1:1: Unclosed passage "car"\n' +
            "Passage reference errors:\n" +
            "  docs/guide.md:1:4: Unknown reference: ::SPOOL:: <<car.ts#missing>>\n",
        );
      }));
  });
});
