import { test, expect, describe, mock, afterEach, beforeEach, jest } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTempDir, flushMacrotasks, createFile, writeConfig, makeWritable } from "../../../tests/helpers.ts";

type WatchListener = (event: string, filename: string | null) => void;
const mockWatch = mock((_path: string, _options: unknown, _listener: WatchListener) => {});

mock.module("node:fs", () => ({
  ...require("node:fs"),
  watch: mockWatch,
}));

const { previewCommand } = await import("./command.ts");

afterEach(() => {
  mock.clearAllMocks();
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

        const calledPaths = mockWatch.mock.calls.map((c) => c[0]);
        expect(calledPaths).not.toContain(join(root, "src/docs"));
      }));

    describe("when the watcher fires", () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      test("schedules a reweave with a 200ms debounce", () =>
        withTempDir(async (root) => {
          await writeConfig(root);
          await mkdir(join(root, "src"), { recursive: true });
          await createFile(root, "docs/guide.md", "# Guide");

          let capturedListener: WatchListener | null = null;
          mockWatch.mockImplementation((_path, _options, listener) => {
            capturedListener = listener;
          });

          const { server } = await previewCommand({ cwd: root, stdout: makeWritable(), port: "0" });
          try {
            capturedListener!("change", "guide.md");
            expect(jest.getTimerCount()).toBe(1);

            await jest.advanceTimersByTime(199);
            expect(jest.getTimerCount()).toBe(1);

            await jest.advanceTimersByTime(1);
            expect(jest.getTimerCount()).toBe(0);
          } finally {
            await server.stop();
          }
        }));

      test("debounces rapid watcher callbacks into a single reweave", () =>
        withTempDir(async (root) => {
          await writeConfig(root);
          await mkdir(join(root, "src"), { recursive: true });
          await createFile(root, "docs/guide.md", "# Guide");

          let capturedListener: WatchListener | null = null;
          mockWatch.mockImplementation((_path, _options, listener) => {
            capturedListener = listener;
          });

          const stdout = makeWritable();
          const { server } = await previewCommand({ cwd: root, stdout, port: "0" });
          const initialOutput = stdout.output;

          try {
            capturedListener!("change", "a.md");
            capturedListener!("change", "b.md");
            capturedListener!("change", "c.md");

            expect(jest.getTimerCount()).toBe(1);

            await jest.advanceTimersByTime(200);
            // Two flushes are needed here because the live Bun.serve server adds
            // an extra async hop compared to weaveProject alone — one flush drains
            // the I/O callbacks from weaveProject, the second drains those from the
            // server's internal response handling.
            await flushMacrotasks();
            await flushMacrotasks();

            expect(stdout.output).toBe(initialOutput + "Re-wove: 1 file(s) written.\n");
          } finally {
            await server.stop();
          }
        }));
    });
  });
});
