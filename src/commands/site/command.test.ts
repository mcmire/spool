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

// Mock http server so we don't bind to real ports in tests
const mockHttpServer = {
  listen: vi.fn((_port: number, cb: () => void) => cb()),
  address: vi.fn(() => ({ port: 5173 })),
  close: vi.fn(),
};

vi.mock("node:http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:http")>()),
  createServer: vi.fn(() => mockHttpServer),
}));

const mockViteServer = {
  middlewares: vi.fn(),
  ssrLoadModule: vi.fn(() => Promise.resolve({ Renderer: class { render() { return { status: 200, body: "" }; } } })),
  close: vi.fn(() => Promise.resolve()),
};
const mockCreateViteServer = vi.fn(() => Promise.resolve(mockViteServer));
const mockBuild = vi.fn(() => Promise.resolve());

vi.mock("vite", () => ({
  createServer: mockCreateViteServer,
  build: mockBuild,
}));

// Mock child_process so prerender.js subprocess doesn't run in tests
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => cb(null)),
}));

const { siteDevCommand, siteBuildCommand } = await import("./command.ts");

afterEach(() => {
  vi.clearAllMocks();
});

describe("writeEngineFiles", () => {
  describe("when siteDevCommand is called", () => {
    test("copies SpoolPassage.jsx into .site/engine/", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/index.md", "# Hello");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const component = await readFile(
          join(root, ".site", "engine", "SpoolPassage.jsx"),
          "utf-8",
        );
        expect(component).toContain("spool-passage");
        expect(component).toContain("anchor");
      }));

    test("copies vite.config.js into .site/engine/", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/index.md", "# Hello");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const config = await readFile(
          join(root, ".site", "engine", "vite.config.js"),
          "utf-8",
        );
        expect(config).toContain("@mdx-js/rollup");
        expect(config).toContain("@vitejs/plugin-react");
      }));
  });
});

describe("writeNavData", () => {
  describe("when called with a basic config", () => {
    test("writes nav-data.js with a default title", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/index.md", "# Hello");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const navData = await readFile(
          join(root, ".site", "engine", "nav-data.js"),
          "utf-8",
        );
        expect(navData).toContain('"title"');
        expect(navData).toContain('"sidebar"');
      }));

    test("uses the title from config.site when provided", () =>
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
        await createFile(root, "docs/index.md", "# Hello");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const navData = await readFile(
          join(root, ".site", "engine", "nav-data.js"),
          "utf-8",
        );
        expect(navData).toContain('"My Docs"');
      }));
  });
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
        expect(stdout.output).toMatch(/Dev server running at http:\/\/localhost:\d+ \(ready in \d+\.\d+s\)/);
      }));

    test("calls Vite createServer with the engine config file", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        expect(mockCreateViteServer).toHaveBeenCalledWith(
          expect.objectContaining({
            configFile: join(root, ".site", "engine", "vite.config.js"),
          }),
        );
      }));

    test("writes woven files into .site/pages/ as .mdx files", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const written = await readFile(join(root, ".site", "pages", "guide.mdx"), "utf-8");
        expect(written).toBe("# Guide");
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

    test("calls Vite build with the server config file", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteBuildCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        expect(mockBuild).toHaveBeenCalledWith(
          expect.objectContaining({
            configFile: join(root, ".site", "engine", "vite.config.server.js"),
          }),
        );
      }));

    test("writes woven files into .site/pages/ as .mdx files", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteBuildCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const written = await readFile(join(root, ".site", "pages", "guide.mdx"), "utf-8");
        expect(written).toBe("# Guide");
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

    test("does not call Vite build when there are errors", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "::SPOOL:: <<src/missing.ts#passage>>");

        await siteBuildCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
        });

        expect(mockBuild).not.toHaveBeenCalled();
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
    test("writes spool-link-plugin.js with the passage map", () =>
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

        const plugin = await readFile(
          join(root, ".site", "engine", "spool-link-plugin.js"),
          "utf-8",
        );
        expect(plugin).toContain("spoolLinkPlugin");
        expect(plugin).toContain("passageMap");
      }));
  });
});
