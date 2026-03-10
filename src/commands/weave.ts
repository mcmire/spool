import { findProjectRoot, loadConfig } from "../config.ts";
import { weaveProject } from "../weaver.ts";
import type { FileErrors } from "../registries.ts";

function printErrors(fileErrors: FileErrors[]): void {
  for (const { filePath, errors } of fileErrors) {
    for (const error of errors) {
      console.error(`  ${filePath}:${error.line}:${error.column}: ${error.message}`);
    }
  }
}

export async function weaveCommand(): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const config = await loadConfig(projectRoot);
  const result = await weaveProject(projectRoot, config);

  console.log(
    `Wove ${result.filesProcessed} doc file(s), wrote ${result.filesWritten} output(s).`,
  );

  const hasErrors =
    result.registryErrors.length > 0 || result.weaveErrors.length > 0;

  if (result.registryErrors.length > 0) {
    console.error("\nSource file errors:");
    printErrors(result.registryErrors);
  }

  if (result.weaveErrors.length > 0) {
    console.error("\nWeave errors:");
    printErrors(result.weaveErrors);
  }

  if (hasErrors) {
    process.exit(1);
  }
}
