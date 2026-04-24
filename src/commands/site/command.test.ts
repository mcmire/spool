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

const mockStop = vi.fn(() => Promise.resolve());
const mockListen = vi.fn(() => Promise.resolve());
const mockHttpServer = { address: () => ({ port: 5173 }) };
const mockDevServer = {
  listen: mockListen,
  close: mockStop,
  httpServer: mockHttpServer,
};
const mockCreateServer = vi.fn(() => Promise.resolve(mockDevServer));
const mockBuild = vi.fn(() => Promise.resolve());

vi.mock("vitepress", () => ({
  createServer: mockCreateServer,
  build: mockBuild,
}));

const { siteDevCommand, siteBuildCommand } = await import("./command.ts");

afterEach(() => {
  vi.clearAllMocks();
});

describe("writeVitePressConfig", () => {
  describe("when called with a basic config", () => {
    test('writes a .site/.vitepress/config.js with srcDir set to "."', () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/index.md", "# Hello");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const config = await readFile(join(root, ".site", ".vitepress", "config.js"), "utf-8");
        expect(config).toContain('"srcDir": "."');
      }));

    test("includes default local search in themeConfig", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/index.md", "# Hello");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const config = await readFile(join(root, ".site", ".vitepress", "config.js"), "utf-8");
        expect(config).toContain('"provider": "local"');
      }));

    test("merges the site field from spool.json into the VitePress config", () =>
      withTempDir(async (root) => {
        await writeFile(
          join(root, "spool.json"),
          JSON.stringify({
            source: { code: "src", docs: "docs" },
            target: "out",
            site: { title: "My Docs", description: "A test site" },
          }),
          "utf-8",
        );
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/index.md", "# Hello");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const config = await readFile(join(root, ".site", ".vitepress", "config.js"), "utf-8");
        expect(config).toContain('"title": "My Docs"');
        expect(config).toContain('"description": "A test site"');
      }));

    test("does not override themeConfig when provided in site field", () =>
      withTempDir(async (root) => {
        await writeFile(
          join(root, "spool.json"),
          JSON.stringify({
            source: { code: "src", docs: "docs" },
            target: "out",
            site: { themeConfig: { nav: [{ text: "Home", link: "/" }] } },
          }),
          "utf-8",
        );
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/index.md", "# Hello");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const config = await readFile(join(root, ".site", ".vitepress", "config.js"), "utf-8");
        expect(config).toContain('"nav"');
        // Default local search should not be injected since themeConfig is user-supplied
        expect(config).not.toContain('"provider": "local"');
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

        expect(stdout.output).toContain("Dev server running at http://localhost:");
      }));

    test("calls VitePress createServer with the .site directory", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        expect(mockCreateServer).toHaveBeenCalledWith(
          join(root, ".site"),
          expect.objectContaining({}),
        );
      }));

    test("writes woven files into .site directory", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const written = await readFile(join(root, ".site", "guide.md"), "utf-8");
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
        // The debounced callback runs weaveProject + copyWovenFiles (which uses
        // fast-glob). These need many event loop ticks to settle, so we switch
        // to real timers and poll for the expected output.
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

    test("calls VitePress build with the .site directory", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteBuildCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        expect(mockBuild).toHaveBeenCalledWith(join(root, ".site"));
      }));

    test("writes woven files into .site directory", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        await siteBuildCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const written = await readFile(join(root, ".site", "guide.md"), "utf-8");
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
        // Reference a passage that doesn't exist
        await createFile(root, "docs/guide.md", "::SPOOL:: <<missing.ts#passage>>");

        const result = await siteBuildCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
        });

        expect(result.exitCode).toBe(1);
      }));

    test("does not call VitePress build when there are errors", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "::SPOOL:: <<missing.ts#passage>>");

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
        await createFile(root, "docs/page1.md", "::SPOOL:: <<car.ts>>");
        await createFile(root, "docs/page2.md", "::SPOOL:: <<car.ts>>");

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
    test("includes the shiki transformer in the VitePress config", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(root, "src/car.ts", "export function drive() {}");
        await createFile(root, "docs/guide.md", "::SPOOL:: <<car.ts>>");

        await siteBuildCommand({
          cwd: root,
          stdout: makeWritable(),
          stderr: makeWritable(),
          linkReferences: true,
        });

        const config = await readFile(join(root, ".site", ".vitepress", "config.js"), "utf-8");
        expect(config).toContain("spoolLinkTransformer");
        expect(config).toContain("passageMap");
      }));
  });
});

describe("writeVitePressTheme", () => {
  describe("when siteDevCommand is called", () => {
    test("writes the theme index.ts file", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/index.md", "# Hello");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const themeIndex = await readFile(
          join(root, ".site", ".vitepress", "theme", "index.ts"),
          "utf-8",
        );
        expect(themeIndex).toContain("SpoolPassage");
        expect(themeIndex).toContain("DefaultTheme");
      }));

    test("writes the SpoolPassage.vue component", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/index.md", "# Hello");

        await siteDevCommand({ cwd: root, stdout: makeWritable(), stderr: makeWritable() });

        const component = await readFile(
          join(root, ".site", ".vitepress", "theme", "SpoolPassage.vue"),
          "utf-8",
        );
        expect(component).toContain("spool-passage");
        expect(component).toContain("anchor");
      }));
  });
});
