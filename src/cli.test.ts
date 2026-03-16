import { test, expect, describe } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
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
