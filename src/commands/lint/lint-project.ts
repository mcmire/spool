import { readFile } from "node:fs/promises";
import { join, relative, posix } from "node:path";
import { Glob } from "bun";
import type { SpoolConfig } from "../../config.ts";
import { parsePassageReferences } from "../../parser.ts";
import { buildRegistries } from "../../registries.ts";
import type { FileErrors } from "../../registries.ts";

export type LintResult = {
  registryErrors: FileErrors[];
  docErrors: FileErrors[];
};

export async function lintProject(projectRoot: string, config: SpoolConfig): Promise<LintResult> {
  const { registry, errors: registryErrors } = await buildRegistries(projectRoot, config);

  const docErrors: FileErrors[] = [];
  const docsDir = join(projectRoot, config.source.docs);

  const glob = new Glob("**/*.md");
  for await (const entry of glob.scan({ cwd: docsDir })) {
    const fullPath = join(docsDir, entry);
    const content = await readFile(fullPath, "utf-8");
    const { refs } = parsePassageReferences(content);

    const errors = [];
    for (const ref of refs) {
      const key = `${posix.join(config.source.code, ref.filePath)}:${ref.passageName}`;
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

  return { registryErrors, docErrors };
}
