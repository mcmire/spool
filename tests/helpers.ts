import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { jest } from "bun:test";
import type { SpoolConfig } from "../src/config.ts";

// Bun's useFakeTimers patches setTimeout globally regardless of how it is
// imported (global, node:timers, node:timers/promises), so there is no way to
// hold a reference to the real one. Instead we temporarily restore real timers,
// wait one macrotask tick for any pending I/O callbacks to complete, then
// re-enable fake timers.
export async function flushMacrotasks(): Promise<void> {
  jest.useRealTimers();
  await new Promise((resolve) => setTimeout(resolve, 0));
  jest.useFakeTimers();
}

export async function withTempDir(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "spool-test-"));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function createFile(root: string, relPath: string, content: string): Promise<void> {
  const fullPath = join(root, relPath);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
}

export async function writeConfig(root: string): Promise<void> {
  await writeFile(
    join(root, "spool.json"),
    JSON.stringify({ source: { code: "src", docs: "docs" }, target: "out" }),
    "utf-8",
  );
}

export function makeConfig(overrides?: Partial<SpoolConfig["source"]>): SpoolConfig {
  return {
    source: { code: "src", docs: "docs", ...overrides },
    target: "out",
  };
}

export function makeWritable(): { write(s: string): void; output: string } {
  let output = "";
  return {
    write(s: string) {
      output += s;
    },
    get output() {
      return output;
    },
  };
}
