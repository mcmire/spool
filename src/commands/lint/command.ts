import { findProjectRoot, loadConfig } from "../../config.ts";
import { lintProject } from "./lint-project.ts";
import type { FileErrors } from "../../registries.ts";

type Writable = { write(s: string): void };

export type LintCommandOptions = {
  cwd: string;
  stdout: Writable;
  stderr: Writable;
};

export type LintCommandResult = {
  exitCode?: number;
};

function printErrors(fileErrors: FileErrors[], stderr: Writable): void {
  for (const { filePath, errors } of fileErrors) {
    for (const error of errors) {
      stderr.write(`  ${filePath}:${error.line}:${error.column}: ${error.message}\n`);
    }
  }
}

export async function lintCommand({
  cwd,
  stdout,
  stderr,
}: LintCommandOptions): Promise<LintCommandResult> {
  const projectRoot = findProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const { registryErrors, docErrors } = await lintProject(projectRoot, config);

  const hasErrors = registryErrors.length > 0 || docErrors.length > 0;

  if (registryErrors.length > 0) {
    stderr.write("Source file errors:\n");
    printErrors(registryErrors, stderr);
  }

  if (docErrors.length > 0) {
    stderr.write("Passage reference errors:\n");
    printErrors(docErrors, stderr);
  }

  if (hasErrors) {
    return { exitCode: 1 };
  }

  stdout.write("No errors found.\n");
  return {};
}
