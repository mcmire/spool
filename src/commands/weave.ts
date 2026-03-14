import { watch } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { findProjectRoot, loadConfig } from "../config.ts";
import type { SpoolConfig } from "../config.ts";
import { weaveProject } from "../weaver.ts";
import type { FileErrors } from "../registries.ts";

function printErrors(fileErrors: FileErrors[]): void {
  for (const { filePath, errors } of fileErrors) {
    for (const error of errors) {
      console.error(`  ${filePath}:${error.line}:${error.column}: ${error.message}`);
    }
  }
}

async function runWeave(projectRoot: string, config: SpoolConfig): Promise<boolean> {
  const result = await weaveProject(projectRoot, config);

  console.log(`Wove ${result.filesProcessed} doc file(s), wrote ${result.filesWritten} output(s).`);

  const hasErrors = result.registryErrors.length > 0 || result.weaveErrors.length > 0;

  if (result.registryErrors.length > 0) {
    console.error("\nSource file errors:");
    printErrors(result.registryErrors);
  }

  if (result.weaveErrors.length > 0) {
    console.error("\nWeave errors:");
    printErrors(result.weaveErrors);
  }

  return hasErrors;
}

export async function weaveCommand(options: { watch?: boolean; clean?: boolean }): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const config = await loadConfig(projectRoot);

  if (options.clean) {
    const targetDir = join(projectRoot, config.target);
    await rm(targetDir, { recursive: true, force: true });
  }

  const hasErrors = await runWeave(projectRoot, config);

  if (!options.watch) {
    if (hasErrors) {
      process.exit(1);
    }
    return;
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
        await runWeave(projectRoot, config);
      } catch (err) {
        console.error("Re-weave failed:", err);
      }
    }, 200);
  }

  console.log("Watching for changes…");

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
}
