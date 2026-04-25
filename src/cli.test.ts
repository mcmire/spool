import { test, expect, describe } from "vitest";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { withTempDir, createFile, writeConfig } from "../tests/helpers.ts";

const CLI = fileURLToPath(new URL("cli.ts", import.meta.url));
// Resolve tsx from this project's node_modules so it's found regardless of CWD.
// --import requires a file: URL (not a bare path) when the specifier is absolute.
const TSX_ESM = new URL("../node_modules/tsx/dist/esm/index.mjs", import.meta.url).href;

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
  const result = await execa("node", ["--import", TSX_ESM, CLI, ...args], {
    cwd,
    stdin: "ignore",
    reject: false,
    stripFinalNewline: false,
    timeout: opts.timeout ?? 10_000,
  });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? null };
}

async function spawnCLI(
  args: string[],
  cwd: string,
): Promise<{
  proc: ReturnType<typeof execa>;
  readLine(): Promise<string>;
  kill(): void;
}> {
  const proc = execa("node", ["--import", TSX_ESM, CLI, ...args], {
    cwd,
    stdin: "ignore",
  });
  proc.catch(() => {}); // suppress unhandled rejection on kill

  const rl = createInterface({ input: proc.stdout! });
  const lineIter = rl[Symbol.asyncIterator]();

  async function readLine(): Promise<string> {
    const { value } = await lineIter.next();
    return value as string;
  }

  return { proc, readLine, kill: () => proc.kill() };
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
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#car>>");

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
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#car>>");

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
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#missing>>");

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

        const { proc, readLine, kill } = await spawnCLI(["weave", "--watch"], root);
        try {
          const line1 = await readLine();
          const line2 = await readLine();
          expect(line1).toBe("Wove 1 doc file(s), wrote 1 output(s).");
          expect(line2).toBe("Watching for changes…");
        } finally {
          kill();
          await new Promise((resolve) => proc.on("close", resolve));
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
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#car>>");

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
        await createFile(root, "docs/guide.md", "// ::SPOOL:: <<src/car.ts#missing>>");

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
    proc: ReturnType<typeof execa>;
    send(msg: unknown): void;
    readMessage(): Promise<JsonRpcMessage>;
    readNotification(method: string): Promise<JsonRpcMessage>;
    kill(): void;
  }> {
    const proc = execa("node", ["--import", TSX_ESM, CLI, "lsp"], { cwd: root });
    proc.catch(() => {}); // suppress unhandled rejection on kill

    const decoder = new TextDecoder("utf-8");
    let raw = "";
    let pendingResolver: ((msg: JsonRpcMessage) => void) | null = null;
    const messageQueue: JsonRpcMessage[] = [];

    function tryParseMessage(): JsonRpcMessage | null {
      const headerEnd = raw.indexOf("\r\n\r\n");
      if (headerEnd === -1) return null;
      const header = raw.slice(0, headerEnd);
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) throw new Error(`No Content-Length in header: ${header}`);
      const contentLength = parseInt(lengthMatch[1]!, 10);
      const bodyStart = headerEnd + 4;
      const bodyBytes = Buffer.from(raw.slice(bodyStart), "utf-8");
      if (bodyBytes.length < contentLength) return null;
      raw = bodyBytes.slice(contentLength).toString("utf-8");
      return JSON.parse(bodyBytes.slice(0, contentLength).toString("utf-8")) as JsonRpcMessage;
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      raw += decoder.decode(chunk);
      const msg = tryParseMessage();
      if (msg !== null) {
        if (pendingResolver) {
          const res = pendingResolver;
          pendingResolver = null;
          res(msg);
        } else {
          messageQueue.push(msg);
        }
      }
    });

    async function readMessage(): Promise<JsonRpcMessage> {
      if (messageQueue.length > 0) {
        return messageQueue.shift()!;
      }
      return new Promise((resolve) => {
        pendingResolver = resolve;
      });
    }

    function send(msg: unknown): void {
      proc.stdin!.write(encodeMessage(msg));
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
      const response = await readMessage();
      if (response["id"] !== 1) throw new Error(`Unexpected response: ${JSON.stringify(response)}`);
      send({ jsonrpc: "2.0", method: "initialized", params: {} });
    }

    await initialize();
    await new Promise((resolve) => setTimeout(resolve, 500));

    async function readNotification(method: string): Promise<JsonRpcMessage> {
      while (true) {
        const msg = await readMessage();
        if (msg["method"] === method) return msg;
      }
    }

    function kill(): void {
      proc.kill();
    }

    return { proc, send, readMessage, readNotification, kill };
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
                text: "::SPOOL:: <<src/car.ts#missing>>",
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
          client.kill();
          await new Promise((resolve) => client.proc.on("close", resolve));
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
          client.kill();
          await new Promise((resolve) => client.proc.on("close", resolve));
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
        await createFile(root, "docs/guide.md", "::SPOOL:: <<src/car.ts#car>>");

        const realRoot = realpathSync(root);
        const client = await startLspClient(root);
        try {
          const docUri = `file://${realRoot}/docs/guide.md`;
          const srcUri = `file://${realRoot}/src/car.ts`;

          client.send({
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: {
                uri: docUri,
                languageId: "markdown",
                version: 1,
                text: "::SPOOL:: <<src/car.ts#car>>",
              },
            },
          });

          const initial = await client.readNotification("textDocument/publishDiagnostics");
          const initialParams = initial["params"] as { diagnostics: unknown[] };
          expect(initialParams.diagnostics).toHaveLength(0);

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
          await client.readNotification("textDocument/publishDiagnostics");

          client.send({
            jsonrpc: "2.0",
            method: "textDocument/didSave",
            params: {
              textDocument: { uri: srcUri },
            },
          });

          const revalidated = await client.readNotification("textDocument/publishDiagnostics");
          const revalidatedParams = revalidated["params"] as {
            uri: string;
            diagnostics: unknown[];
          };
          expect(revalidatedParams.uri).toBe(docUri);
          expect(revalidatedParams.diagnostics).toHaveLength(0);
        } finally {
          client.kill();
          await new Promise((resolve) => client.proc.on("close", resolve));
        }
      }));
  });
});

describe("spool site dev", () => {
  describe("when the server starts", () => {
    test(
      "prints the initial weave summary and server URL",
      () =>
        withTempDir(async (root) => {
          await writeConfig(root);
          await mkdir(join(root, "src"), { recursive: true });
          await createFile(root, "docs/guide.md", "# Guide");

          const { proc, readLine, kill } = await spawnCLI(["site", "dev"], root);
          try {
            const line1 = await readLine();
            expect(line1).toBe("Initial weave: 1 file(s) written.");
            // VitePress may emit port-conflict messages before the server URL, so
            // keep reading until we see the URL line.
            let serverLine = "";
            while (!serverLine.startsWith("Dev server running at")) {
              serverLine = await readLine();
            }
            expect(serverLine).toMatch(/^Dev server running at http:\/\/localhost:\d+$/);
          } finally {
            kill();
            await new Promise((resolve) => proc.on("close", resolve));
          }
        }),
      30_000,
    );
  });
});

describe("spool site build", () => {
  describe("when the project has no errors", () => {
    test(
      "exits 0 and prints a success message",
      () =>
        withTempDir(async (root) => {
          await writeConfig(root);
          await mkdir(join(root, "src"), { recursive: true });
          await createFile(root, "docs/guide.md", "# Guide");

          const { stdout, exitCode } = await runCLI(["site", "build"], root, { timeout: 30_000 });

          expect(exitCode).toBe(0);
          expect(stdout).toContain("Initial weave: 1 file(s) written.");
          expect(stdout).toContain("Site built successfully.");
        }),
      30_000,
    );
  });

  describe("when the project has weave errors", () => {
    test("exits 1 without building", () =>
      withTempDir(async (root) => {
        await writeConfig(root);
        await mkdir(join(root, "src"), { recursive: true });
        await createFile(root, "docs/guide.md", "::SPOOL:: <<src/missing.ts#passage>>");

        const { stderr, exitCode } = await runCLI(["site", "build"], root);

        expect(exitCode).toBe(1);
        expect(stderr).toContain("Unknown reference");
      }));
  });
});
