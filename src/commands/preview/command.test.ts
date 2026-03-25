import { test, expect, describe, vi, afterEach } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as http from "node:http";
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

const { previewCommand } = await import("./command.ts");

afterEach(() => {
  vi.clearAllMocks();
});

describe("previewCommand", () => {
  describe("when the server starts successfully", () => {
    test("writes the initial weave summary to stdout", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const stdout = makeWritable();
        const { server } = await previewCommand({ cwd: root, stdout, port: "0" });
        await server.stop();

        expect(stdout.output).toContain("Initial weave: 1 file(s) written.\n");
      }));

    test("writes the server URL to stdout", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const stdout = makeWritable();
        const { server } = await previewCommand({ cwd: root, stdout, port: "0" });
        const { port } = server;
        await server.stop();

        expect(stdout.output).toContain(`Preview server running at http://localhost:${port}\n`);
      }));
  });

  describe("when a markdown file is requested", () => {
    test("responds with rendered HTML", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Hello");

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        try {
          const res = await fetch(`http://localhost:${server.port}/guide.md`);
          const html = await res.text();
          expect(res.status).toBe(200);
          expect(res.headers.get("content-type")).toContain("text/html");
          expect(html).toContain("<h1>Hello</h1>");
        } finally {
          await server.stop();
        }
      }));
  });

  describe("when a non-existent file is requested", () => {
    test("responds with 404", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        try {
          const res = await fetch(`http://localhost:${server.port}/missing.md`);
          expect(res.status).toBe(404);
        } finally {
          await server.stop();
        }
      }));
  });

  describe("when the root path is requested", () => {
    test("serves index.md", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/index.md", "# Index");

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        try {
          const res = await fetch(`http://localhost:${server.port}/`);
          const html = await res.text();
          expect(res.status).toBe(200);
          expect(html).toContain("<h1>Index</h1>");
        } finally {
          await server.stop();
        }
      }));
  });

  describe("when a directory path is requested and an index.md exists inside it", () => {
    test("serves the index.md as HTML", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/foo/index.md", "# Foo Index");

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        try {
          const res = await fetch(`http://localhost:${server.port}/foo`);
          const html = await res.text();
          expect(res.status).toBe(200);
          expect(res.headers.get("content-type")).toContain("text/html");
          expect(html).toContain("<h1>Foo Index</h1>");
        } finally {
          await server.stop();
        }
      }));
  });

  describe("when a markdown file in a subdirectory contains relative links", () => {
    test("rewrites relative links to be root-relative", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/foo/bar.md", "[go to baz](./baz.md)");
        await createFile(root, "docs/foo/baz.md", "# Baz");

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        try {
          const res = await fetch(`http://localhost:${server.port}/foo/bar.md`);
          const html = await res.text();
          expect(html).toContain('href="/foo/baz.md"');
        } finally {
          await server.stop();
        }
      }));

    test("does not rewrite absolute links", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/foo/bar.md", "[external](https://example.com)");

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        try {
          const res = await fetch(`http://localhost:${server.port}/foo/bar.md`);
          const html = await res.text();
          expect(html).toContain('href="https://example.com"');
        } finally {
          await server.stop();
        }
      }));
  });

  describe("when a directory index contains relative links", () => {
    test("rewrites relative links relative to the index file's directory", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/foo/index.md", "[go to bar](./bar.md)");
        await createFile(root, "docs/foo/bar.md", "# Bar");

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        try {
          const res = await fetch(`http://localhost:${server.port}/foo`);
          const html = await res.text();
          expect(html).toContain('href="/foo/bar.md"');
        } finally {
          await server.stop();
        }
      }));
  });

  describe("when a directory path is requested and no index.md exists inside it", () => {
    test("responds with 404", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        try {
          const res = await fetch(`http://localhost:${server.port}/foo`);
          expect(res.status).toBe(404);
        } finally {
          await server.stop();
        }
      }));
  });

  describe("when the default port is already in use", () => {
    test("binds to the next available port", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        // Occupy a known port so previewCommand is forced to try the next one
        const blocker = http.createServer();
        await new Promise<void>((resolve) => blocker.listen(0, "localhost", resolve));
        const blockedPort = (blocker.address() as { port: number }).port;

        try {
          const { server } = await previewCommand({
            cwd: root,
            stdout: makeWritable(),
            port: String(blockedPort),
          });
          try {
            expect(server.port).toBe(blockedPort + 1);
          } finally {
            await server.stop();
          }
        } finally {
          await new Promise<void>((resolve, reject) =>
            blocker.close((err) => (err ? reject(err) : resolve())),
          );
        }
      }));
  });

  describe("when the watch option is set", () => {
    test("calls watch on the source directory with recursive: true", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        await server.stop();

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

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        await server.stop();

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

        const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
        await server.stop();

        const calledPaths = mockWatch.mock.calls.map((c: unknown[]) => c[0]);
        expect(calledPaths).not.toContain(join(root, "src/docs"));
      }));

    describe("when the watcher fires", () => {
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

          const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
          // Switch to fake timers only after previewCommand resolves. If fake timers were
          // installed earlier, they would intercept the real async operations inside
          // previewCommand (port binding, initial weave) and cause it to hang.
          vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["setTimeout", "clearTimeout"] });
          try {
            capturedListener!("change", "guide.md");
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(199);
            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(1);
            expect(vi.getTimerCount()).toBe(0);
            await flushMacrotasks();
          } finally {
            vi.useRealTimers();
            await server.stop();
          }
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
          const { server } = await previewCommand({ cwd: root, stdout, port: "0" });
          const initialOutput = stdout.output;

          // Switch to fake timers only after previewCommand resolves. If fake timers were
          // installed earlier, they would intercept the real async operations inside
          // previewCommand (port binding, initial weave) and cause it to hang.
          vi.useFakeTimers({ shouldAdvanceTime: false, toFake: ["setTimeout", "clearTimeout"] });
          try {
            capturedListener!("change", "a.md");
            capturedListener!("change", "b.md");
            capturedListener!("change", "c.md");

            expect(vi.getTimerCount()).toBe(1);

            await vi.advanceTimersByTimeAsync(200);
            vi.useRealTimers();
            await new Promise((resolve) => setTimeout(resolve, 500));

            expect(stdout.output).toBe(initialOutput + "Re-wove: 1 file(s) written.\n");
          } finally {
            vi.useRealTimers();
            await server.stop();
          }
        }));
    });
  });
});
