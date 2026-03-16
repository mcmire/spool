import { test, expect, describe } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { withTempDir, createFile, writeConfig } from "../tests/helpers.ts";

const CLI = join(import.meta.dir, "cli.ts");

type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

async function runCLI(
  args: string[],
  cwd: string,
  opts: { timeout?: number } = {},
): Promise<SpawnResult> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = opts.timeout ?? 10_000;
  const timer = setTimeout(() => proc.kill(), timeout);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

async function spawnCLI(
  args: string[],
  cwd: string,
): Promise<{ proc: ReturnType<typeof Bun.spawn>; readLine(): Promise<string> }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  async function readLine(): Promise<string> {
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        return line;
      }
      const { done, value } = await reader.read();
      if (done) return buffer;
      buffer += decoder.decode(value);
    }
  }

  return { proc, readLine };
}

describe("spool weave", () => {
  describe("when the project has no errors", () => {
    test("exits 0 and writes a summary to stdout", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#car>>");

        const { stdout, exitCode } = await runCLI(["weave"], root);

        expect(exitCode).toBe(0);
        expect(stdout).toBe("Wove 1 doc file(s), wrote 1 output(s).\n");
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

        await runCLI(["weave"], root);

        const output = await readFile(join(root, "out/guide.md"), "utf-8");
        expect(output).toBe("class Car {}");
      }));
  });

  describe("when a passage reference is unknown", () => {
    test("exits 1 and writes errors to stderr", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#missing>>");

        const { stderr, exitCode } = await runCLI(["weave"], root);

        expect(exitCode).toBe(1);
        expect(stderr).toContain("Weave errors:");
        expect(stderr).toContain("Unknown reference");
      }));
  });

  describe("when the --clean flag is set", () => {
    test("removes stale files from the target directory before weaving", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");
        await createFile(root, "out/stale.md", "stale");

        await runCLI(["weave", "--clean"], root);

        await expect(readFile(join(root, "out/stale.md"), "utf-8")).rejects.toThrow();
      }));
  });

  describe("when the --watch flag is set", () => {
    test("prints the weave summary then begins watching", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const { proc, readLine } = await spawnCLI(["weave", "--watch"], root);
        try {
          const line1 = await readLine();
          const line2 = await readLine();
          expect(line1).toBe("Wove 1 doc file(s), wrote 1 output(s).");
          expect(line2).toBe("Watching for changes…");
        } finally {
          proc.kill();
          await proc.exited;
        }
      }));
  });
});

describe("spool lint", () => {
  describe("when there are no errors", () => {
    test("exits 0 and prints a success message", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#car>>");

        const { stdout, exitCode } = await runCLI(["lint"], root);

        expect(exitCode).toBe(0);
        expect(stdout).toBe("No errors found.\n");
      }));
  });

  describe("when a doc file references an unknown passage", () => {
    test("exits 1 and prints the error to stderr", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<car.ts#missing>>");

        const { stderr, exitCode } = await runCLI(["lint"], root);

        expect(exitCode).toBe(1);
        expect(stderr).toContain("Passage reference errors:");
        expect(stderr).toContain("Unknown reference");
      }));
  });
});

describe("spool lsp", () => {
  function encodeMessage(msg: unknown): Buffer {
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`;
    return Buffer.concat([Buffer.from(header, "ascii"), Buffer.from(body, "utf-8")]);
  }

  type JsonRpcMessage = Record<string, unknown>;

  async function startLspClient(root: string): Promise<{
    proc: ReturnType<typeof Bun.spawn>;
    send(msg: unknown): void;
    readMessage(): Promise<JsonRpcMessage>;
    readNotification(method: string): Promise<JsonRpcMessage>;
  }> {
    const proc = Bun.spawn(["bun", "run", CLI, "lsp"], {
      cwd: root,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder("utf-8");
    let raw = "";

    async function readMessage(): Promise<JsonRpcMessage> {
      while (true) {
        const headerEnd = raw.indexOf("\r\n\r\n");
        if (headerEnd !== -1) {
          const header = raw.slice(0, headerEnd);
          const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
          if (!lengthMatch) throw new Error(`No Content-Length in header: ${header}`);
          const contentLength = parseInt(lengthMatch[1]!, 10);

          // Collect body bytes
          let bodyBuf = Buffer.from(raw.slice(headerEnd + 4), "utf-8");
          while (bodyBuf.length < contentLength) {
            const { done, value } = await reader.read();
            if (done) throw new Error("Stream ended before body was complete");
            bodyBuf = Buffer.concat([bodyBuf, Buffer.from(value)]);
          }
          raw = bodyBuf.slice(contentLength).toString("utf-8");
          return JSON.parse(bodyBuf.slice(0, contentLength).toString("utf-8")) as JsonRpcMessage;
        }

        const { done, value } = await reader.read();
        if (done) throw new Error("Stream ended before header was complete");
        raw += decoder.decode(value, { stream: true });
      }
    }

    function send(msg: unknown): void {
      proc.stdin.write(encodeMessage(msg));
    }

    async function initialize(): Promise<void> {
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          processId: process.pid,
          rootUri: null,
          capabilities: {},
        },
      });
      // Wait for the initialize response
      const response = await readMessage();
      if (response["id"] !== 1) throw new Error(`Unexpected response: ${JSON.stringify(response)}`);
      // Send initialized notification
      send({ jsonrpc: "2.0", method: "initialized", params: {} });
    }

    await initialize();
    // Allow time for onInitialized to rebuild registries
    await new Promise((resolve) => setTimeout(resolve, 500));

    async function readNotification(method: string): Promise<JsonRpcMessage> {
      while (true) {
        const msg = await readMessage();
        if (msg["method"] === method) return msg;
      }
    }

    return { proc, send, readMessage, readNotification };
  }

  describe("when a doc file is changed with an unknown reference", () => {
    test("sends publishDiagnostics with an error for the unknown passage", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const realRoot = realpathSync(root);
        const client = await startLspClient(root);
        try {
          const docUri = `file://${realRoot}/docs/guide.md`;

          client.send({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                uri: docUri,
                languageId: "markdown",
                version: 1,
                text: "::SPOOL:: <<car.ts#missing>>",
              },
            },
          });

          const notification = await client.readNotification("textDocument/publishDiagnostics");

          const params = notification["params"] as {
            uri: string;
            diagnostics: { message: string }[];
          };
          expect(params.uri).toBe(docUri);
          expect(params.diagnostics).toHaveLength(1);
          expect(params.diagnostics[0]!.message).toContain("Unknown file");
        } finally {
          client.proc.kill();
          await client.proc.exited;
        }
      }));
  });

  describe("when a doc file is changed to fix all errors", () => {
    test("sends publishDiagnostics with an empty diagnostics array", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const realRoot = realpathSync(root);
        const client = await startLspClient(root);
        try {
          const docUri = `file://${realRoot}/docs/guide.md`;

          client.send({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                uri: docUri,
                languageId: "markdown",
                version: 1,
                text: "# Guide — no references here",
              },
            },
          });

          const notification = await client.readNotification("textDocument/publishDiagnostics");

          const params = notification["params"] as {
            uri: string;
            diagnostics: unknown[];
          };
          expect(params.uri).toBe(docUri);
          expect(params.diagnostics).toHaveLength(0);
        } finally {
          client.proc.kill();
          await client.proc.exited;
        }
      }));
  });

  describe("when a source file is saved", () => {
    test("sends publishDiagnostics for the open doc after the registry rebuilds", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await createFile(
          root,
          "src/car.ts",
          ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join("\n"),
        );
        await createFile(root, "docs/guide.md", "::SPOOL:: <<car.ts#car>>");

        const realRoot = realpathSync(root);
        const client = await startLspClient(root);
        try {
          const docUri = `file://${realRoot}/docs/guide.md`;
          const srcUri = `file://${realRoot}/src/car.ts`;

          // Open the doc file — registry is already populated at startup
          client.send({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                uri: docUri,
                languageId: "markdown",
                version: 1,
                text: "::SPOOL:: <<car.ts#car>>",
              },
            },
          });

          // Consume the initial diagnostics notification for the doc file
          const initial = await client.readNotification("textDocument/publishDiagnostics");
          const initialParams = initial["params"] as { diagnostics: unknown[] };
          expect(initialParams.diagnostics).toHaveLength(0);

          // Also open the source file so the server tracks it in TextDocuments
          client.send({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                uri: srcUri,
                languageId: "typescript",
                version: 1,
                text: ["// ::SPOOL:: start(#car)", "class Car {}", "// ::SPOOL:: end(#car)"].join(
                  "\n",
                ),
              },
            },
          });
          // Consume the diagnostics sent for the source file open
          await client.readNotification("textDocument/publishDiagnostics");

          // Save the source file — should trigger a registry rebuild then re-validate open docs
          client.send({
            jsonrpc: "2.0",
            method: "textDocument/didSave",
            params: {
              textDocument: { uri: srcUri },
            },
          });

          // After the 300ms debounce the server re-validates all open docs
          const revalidated = await client.readNotification("textDocument/publishDiagnostics");
          const revalidatedParams = revalidated["params"] as {
            uri: string;
            diagnostics: unknown[];
          };
          expect(revalidatedParams.uri).toBe(docUri);
          expect(revalidatedParams.diagnostics).toHaveLength(0);
        } finally {
          client.proc.kill();
          await client.proc.exited;
        }
      }));
  });
});

describe("spool preview", () => {
  describe("when the server starts", () => {
    test("prints the initial weave summary and server URL", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const { proc, readLine } = await spawnCLI(["preview", "--port", "0"], root);
        try {
          const line1 = await readLine();
          const line2 = await readLine();
          expect(line1).toBe("Initial weave: 1 file(s) written.");
          expect(line2).toMatch(/^Preview server running at http:\/\/localhost:\d+$/);
        } finally {
          proc.kill();
          await proc.exited;
        }
      }));

    test("responds to HTTP requests", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Hello");

        const { proc, readLine } = await spawnCLI(["preview", "--port", "0"], root);
        try {
          await readLine(); // weave summary
          const urlLine = await readLine();
          const url = urlLine.replace("Preview server running at ", "");
          const res = await fetch(`${url}/guide.md`);
          expect(res.status).toBe(200);
          expect(res.headers.get("content-type")).toContain("text/html");
        } finally {
          proc.kill();
          await proc.exited;
        }
      }));
  });

  describe("when a custom --port is specified", () => {
    test("starts the server on that port", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "# Guide");

        const { proc, readLine } = await spawnCLI(["preview", "--port", "0"], root);
        try {
          await readLine();
          const urlLine = await readLine();
          expect(urlLine).toMatch(/^Preview server running at http:\/\/localhost:\d+$/);
        } finally {
          proc.kill();
          await proc.exited;
        }
      }));
  });
});
