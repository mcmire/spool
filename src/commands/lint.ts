import { findProjectRoot, loadConfig } from "../config.ts";
import { lintProject } from "../linter.ts";
import type { FileErrors } from "../registries.ts";

function printErrors(fileErrors: FileErrors[]): void {
  for (const { filePath, errors } of fileErrors) {
    for (const error of errors) {
      console.error(`  ${filePath}:${error.line}:${error.column}: ${error.message}`);
    }
  }
}

export async function lintCommand(): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const config = await loadConfig(projectRoot);
  const { registryErrors, docErrors } = await lintProject(projectRoot, config);

  const hasErrors = registryErrors.length > 0 || docErrors.length > 0;

  if (registryErrors.length > 0) {
    console.error("Source file errors:");
    printErrors(registryErrors);
  }

  if (docErrors.length > 0) {
    console.error("Passage reference errors:");
    printErrors(docErrors);
  }

  if (hasErrors) {
    process.exit(1);
  } else {
    console.log("No errors found.");
  }
}
