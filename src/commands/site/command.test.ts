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

const mockViteServer = {
  listen: vi.fn(() => Promise.resolve()),
  httpServer: {
    address: vi.fn(() => ({ port: 5173 })),
  },
  close: vi.fn(() => Promise.resolve()),
  ws: {
    send: vi.fn(),
  },
};
const mockCreateViteServer = vi.fn(() => Promise.resolve(mockViteServer));
const mockViteBuild = vi.fn(() => Promise.resolve());

vi.mock("vite", () => ({
  createServer: mockCreateViteServer,
  build: mockViteBuild,
}));

// Avoid real Shiki initialization in command-level tests; processMarkdown behavior
// is covered in dedicated engine tests.
vi.mock("./engine/process-markdown.ts", () => ({
  processMarkdown: vi.fn(async (content: string) => `<p>${content}</p>`),
}));

const { processMarkdown } = await import("./engine/process-markdown.ts");

const { siteDevCommand, siteBuildCommand } = await import("./command.ts");

afterEach(() => {
  vi.clearAllMocks();
});

describe("siteDevCommand", () => {
  describe("when the server starts successfully", () => {
    test("writes the initial weave summary to stdout", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const stdout = makeWritable();
        await siteDevCommand({ cwd: root, stdout, stderr: makeWritable() });

        expect(stdout.output).toContain("Initial weave: 1 file(s) written.\n");
      }));

    test("writes the dev server URL to stdout", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const stdout = makeWritable();
        await siteDevCommand({ cwd: root, stdout, stderr: makeWritable() });

        expect(stdout.output).toContain("Warming up dev server...");
        expect(stdout.output).toMatch(
          /Dev server running at http:\/\/localhost:\d+ \(ready in \d+\.\d+s\)/,
        );
      }));

    test("calls Vite createServer with mpa appType and no config file", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        expect(mockCreateViteServer).toHaveBeenCalledWith(
          expect.objectContaining({
            appType: "mpa",
            configFile: false,
          }),
        );
      }));

    test("writes HTML pages into .site/", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const html = await readFile(join(root, ".site", "guide.html"), "utf-8");
        expect(html).toContain("<!DOCTYPE html>");
        expect(html).toContain("<title>Guide</title>");
      }));

    test("embeds the site title in generated HTML", () =>
      withTempDir(async (root) => {
        await writeFile(
          join(root, "spool.json"),
          JSON.stringify({
            source: { code: "src", docs: "docs" },
            target: "out",
            site: { title: "My Docs" },
          }),
          "utf-8",
        );
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const html = await readFile(join(root, ".site", "guide.html"), "utf-8");
        expect(html).toContain("My Docs");
      }));

    test("calls watch on the source directory with recursive: true", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

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

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

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

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const calledPaths = mockWatch.mock.calls.map((c) => c[0]);
        expect(calledPaths).not.toContain(join(root, "src/docs"));
      }));
  });

  describe("when the watcher fires", () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["setTimeout", "clearTimeout"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    test("schedules a reweave with a 200ms debounce", () =>
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

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

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
        await siteDevCommand({ cwd: root, stdout, stderr: makeWritable() });
        const initialOutput = stdout.output;

        capturedListener!("change", "a.md");
        capturedListener!("change", "b.md");
        capturedListener!("change", "c.md");

        expect(vi.getTimerCount()).toBe(1);

        await vi.advanceTimersByTimeAsync(200);
        vi.useRealTimers();
        const expected = initialOutput + "Re-wove: 1 file(s) written.\n";
        await vi.waitFor(() => {
          expect(stdout.output).toBe(expected);
        });
      }));
  });
});

describe("siteBuildCommand", () => {
  describe("when the project has no errors", () => {
    test("writes the initial weave summary to stdout", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const stdout = makeWritable();
        await siteBuildCommand({ cwd: root, stdout, stderr: makeWritable() });

        expect(stdout.output).toContain("Initial weave: 1 file(s) written.\n");
      }));

    test("writes the build success message to stdout", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const stdout = makeWritable();
        await siteBuildCommand({ cwd: root, stdout, stderr: makeWritable() });

        expect(stdout.output).toContain("Site built successfully.\n");
      }));

    test("writes HTML pages to .site/dist/static/", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteBuildCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const html = await readFile(join(root, ".site", "dist", "static", "guide.html"), "utf-8");
        expect(html).toContain("<!DOCTYPE html>");
        expect(html).toContain("<title>Guide</title>");
      }));

    test("copies spool-site.css to the static output", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteBuildCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const css = await readFile(
          join(root, ".site", "dist", "static", "spool-site.css"),
          "utf-8",
        );
        expect(css.length).toBeGreaterThan(0);
      }));

    test("returns no exit code on success", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const result = await siteBuildCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
        });

        expect(result.exitCode).toBeUndefined();
      }));
  });

  describe("when the project has weave errors", () => {
    test("returns exit code 1", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "::SPOOL:: <<src/missing.ts#passage>>");

        const result = await siteBuildCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
        });

        expect(result.exitCode).toBe(1);
      }));

    test("does not write any HTML when there are errors", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "::SPOOL:: <<src/missing.ts#passage>>");

        await siteBuildCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
        });

        await expect(
          readFile(join(root, ".site", "dist", "static", "guide.html"), "utf-8"),
        ).rejects.toThrow();
      }));
  });

  describe("when verifyUniqueReferences is set and a passage is on multiple pages", () => {
    test("returns exit code 1 with reference errors", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(root, "src/car.ts", "export function drive() {}");
        await createFile(root, "docs/page1.md", "::SPOOL:: <<src/car.ts>>");
        await createFile(root, "docs/page2.md", "::SPOOL:: <<src/car.ts>>");

        const stderr = makeWritable();
        const result = await siteBuildCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr,
          verifyUniqueReferences: true,
        });

        expect(result.exitCode).toBe(1);
        expect(stderr.output).toContain("Reference errors");
      }));
  });

  describe("when linkReferences is set", () => {
    test("passes the passage location map to processMarkdown", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(root, "src/car.ts", "export function drive() {}");
        await createFile(root, "docs/guide.md", "::SPOOL:: <<src/car.ts>>");

        await siteBuildCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
          linkReferences: true,
        });

        expect(vi.mocked(processMarkdown)).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Map),
          expect.any(String),
        );
      }));
  });
});
