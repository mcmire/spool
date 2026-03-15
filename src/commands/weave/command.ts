import { watch } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, loadConfig } from "../../config.ts";
import type { SpoolConfig } from "../../config.ts";
import { weaveProject } from "../../weaver.ts";
import type { FileErrors } from "../../registries.ts";

type Writable = { write(s: string): void };

export type WeaveCommandOptions = {
  cwd: string;
  stdout: Writable;
  stderr: Writable;
  watch?: boolean;
  clean?: boolean;
};

export type WeaveCommandResult = {
  exitCode?: number;
};

function printErrors(fileErrors: FileErrors[], stderr: Writable): void {
  for (const { filePath, errors } of fileErrors) {
    for (const error of errors) {
      stderr.write(`  ${filePath}:${error.line}:${error.column}: ${error.message}\n`);
    }
  }
}

async function runWeave(
  projectRoot: string,
  config: SpoolConfig,
  stdout: Writable,
  stderr: Writable,
): Promise<boolean> {
  const result = await weaveProject(projectRoot, config);

  stdout.write(
    `Wove ${result.filesProcessed} doc file(s), wrote ${result.filesWritten} output(s).\n`,
  );

  const hasErrors = result.registryErrors.length > 0 || result.weaveErrors.length > 0;

  if (result.registryErrors.length > 0) {
    stderr.write("\nSource file errors:\n");
    printErrors(result.registryErrors, stderr);
  }

  if (result.weaveErrors.length > 0) {
    stderr.write("\nWeave errors:\n");
    printErrors(result.weaveErrors, stderr);
  }

  return hasErrors;
}

export async function weaveCommand({
  cwd,
  stdout,
  stderr,
  watch: watchMode = false,
  clean = false,
}: WeaveCommandOptions): Promise<WeaveCommandResult> {
  const projectRoot = findProjectRoot(cwd);
  const config = await loadConfig(projectRoot);

  if (clean) {
    const targetDir = join(projectRoot, config.target);
    await rm(targetDir, { recursive: true, force: true });
  }

  const hasErrors = await runWeave(projectRoot, config, stdout, stderr);

  if (!watchMode) {
    return hasErrors ? { exitCode: 1 } : {};
  }

  const sourceDir = join(projectRoot, config.source.code);
  const docsDir = join(projectRoot, config.source.docs);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleReweave(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(async () => {
      try {
        await runWeave(projectRoot, config, stdout, stderr);
      } catch (err) {
        stderr.write(`Re-weave failed: ${err}\n`);
      }
    }, 200);
  }

  stdout.write("Watching for changes…\n");

  watch(sourceDir, { recursive: true }, (_event, filename) => {
    if (filename) {
      scheduleReweave();
    }
  });

  if (!docsDir.startsWith(sourceDir)) {
    watch(docsDir, { recursive: true }, (_event, filename) => {
      if (filename) {
        scheduleReweave();
      }
    });
  }

  return {};
}
