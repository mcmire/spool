import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { jest } from "bun:test";

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
