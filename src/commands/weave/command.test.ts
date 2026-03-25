import { test, expect, describe, vi, afterEach, beforeEach } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  withTempDir,
  flushMacrotasks,
  createFile,
  writeConfig,
  makeWritable,
} from "../../../tests/helpers.ts";

type WatchListener = (event: string, filename: string | null) => void;
const mockWatch = vi.fn((_path: string, _options: unknown, _listener: WatchListener) => {});

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  watch: mockWatch,
}));

const { weaveCommand } = await import("./command.ts");

afterEach(() => {
  vi.clearAllMocks();
});

describe("weaveCommand", () => {
  describe("when there are no errors", () => {
    test("writes a summary to stdout and nothing to stderr", () =>
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
        await weaveCommand({ cwd: root, stdout, stderr });

        expect(stdout.output).toBe("Wove 1 doc file(s), wrote 1 output(s).\n");
        expect(stderr.output).toBe("");
      }));

    test("returns no exitCode", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const { exitCode } = await weaveCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
        });

        expect(exitCode).toBeUndefined();
      }));

    test("writes the woven output to the target directory", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#car>>");

        await weaveCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const output = await readFile(join(root, "out/guide.md"), "utf-8");
        expect(output).toBe("class Car {}");
      }));
  });

  describe("when a doc file references an unknown passage", () => {
    test("writes the weave errors section to stderr", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#missing>>");

        const stderr = makeWritable();
        await weaveCommand({ cwd: root, stdout: makeWritable(), stderr });

        expect(stderr.output).toBe(
          "\nWeave errors:\n" +
            "  docs/guide.md:1:4: Unknown reference: ::SPOOL:: <<car.ts#missing>>\n",
        );
      }));

    test("returns exitCode 1", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#missing>>");

        const { exitCode } = await weaveCommand({
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
        await weaveCommand({ cwd: root, stdout: makeWritable(), stderr });

        expect(stderr.output).toBe(
          "\nSource file errors:\n" + '  src/broken.ts:1:1: Unclosed passage "car"\n',
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

        const { exitCode } = await weaveCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
        });

        expect(exitCode).toBe(1);
      }));
  });

  describe("when the clean option is set", () => {
    test("removes the target directory before weaving", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");
        await createFile(root, "out/stale.md", "stale");

        await weaveCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
          clean: true,
        });

        await expect(readFile(join(root, "out/stale.md"), "utf-8")).rejects.toThrow();
      }));
  });

  describe("when the watch option is set", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["setTimeout", "clearTimeout"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test("writes the weave summary then a watching message to stdout", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const stdout = makeWritable();
        await weaveCommand({ cwd: root, stdout, stderr: makeWritable(), watch: true });

        expect(stdout.output).toBe(
          "Wove 1 doc file(s), wrote 1 output(s).\n" + "Watching for changes…\n",
        );
      }));

    test("calls watch on the source directory with recursive: true", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await weaveCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
          watch: true,
        });

        expect(mockWatch).toHaveBeenCalledWith(
          join(root, "src"),
          { recursive: true },
          expect.any(Function),
        );
      }));

    test("calls watch on the docs directory when it is outside the source directory", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await weaveCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
          watch: true,
        });

        expect(mockWatch).toHaveBeenCalledWith(
          join(root, "docs"),
          { recursive: true },
          expect.any(Function),
        );
      }));

    test("does not call watch on the docs directory when it is inside the source directory", () =>
      withTempDir(async (root) => {
        await writeFile(
          join(root, "spool.json"),
          JSON.stringify({ source: { code: "src", docs: "src/docs" }, target: "out" }),
          "utf-8",
        );
        await createFile(root, "src/docs/guide.md", "# Guide");

        await weaveCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
          watch: true,
        });

        const calledPaths = mockWatch.mock.calls.map((c: unknown[]) => c[0]);
        expect(calledPaths).not.toContain(join(root, "src/docs"));
      }));

    test("schedules a reweave with a 200ms debounce when the watcher callback fires", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        let capturedListener: WatchListener | null = null;
        mockWatch.mockImplementation(
          (_path: string, _options: unknown, listener: WatchListener) => {
            capturedListener = listener;
          },
        );

        await weaveCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
          watch: true,
        });

        capturedListener!("change", "guide.md");
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(199);
        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(1);
        await flushMacrotasks();
        expect(vi.getTimerCount()).toBe(0);
      }));

    test("debounces rapid watcher callbacks into a single reweave", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        let capturedListener: WatchListener | null = null;
        mockWatch.mockImplementation(
          (_path: string, _options: unknown, listener: WatchListener) => {
            capturedListener = listener;
          },
        );

        const stdout = makeWritable();

        await weaveCommand({ cwd: root, stdout, stderr: makeWritable(), watch: true });
        const initialOutput = stdout.output;

        capturedListener!("change", "a.md");
        capturedListener!("change", "b.md");
        capturedListener!("change", "c.md");

        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(200);
        vi.useRealTimers();
        await new Promise((resolve) => setTimeout(resolve, 500));

        expect(stdout.output).toBe(initialOutput + "Wove 1 doc file(s), wrote 1 output(s).\n");
      }));
  });
});
