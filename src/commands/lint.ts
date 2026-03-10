import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Glob } from "bun";
import { findProjectRoot, loadConfig } from "../config.ts";
import { parsePassageReferences } from "../parser.ts";
import { buildRegistries } from "../registries.ts";
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
  const { registry, errors: registryErrors } = await buildRegistries(
    projectRoot,
    config,
  );

  const docErrors: FileErrors[] = [];
  const docsDir = join(projectRoot, config.sourceDocsDir);

  const glob = new Glob("**/*.md");
  for await (const entry of glob.scan({ cwd: docsDir })) {
    const fullPath = join(docsDir, entry);
    const content = await readFile(fullPath, "utf-8");
    const { refs } = parsePassageReferences(content);

    const errors = [];
    for (const ref of refs) {
      const key = `${ref.filePath}:${ref.passageName}`;
      if (!registry.has(key)) {
        errors.push({
          line: ref.line,
          column: ref.column,
          message: `Unknown reference: ${ref.raw}`,
        });
      }
    }

    if (errors.length > 0) {
      const relPath = relative(projectRoot, fullPath);
      docErrors.push({ filePath: relPath, errors });
    }
  }

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
