import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Glob } from "bun";
import type { ParseError, NestedRef } from "./parser.ts";
import { parseSourcePassages } from "./parser.ts";
import type { SpoolConfig } from "./config.ts";

export type PassageRegistry = Map<string, string>;
export type PassageTemplateRegistry = Map<string, string>;

export type FileErrors = {
  filePath: string;
  errors: ParseError[];
};

function buildTemplateContent(lines: string[], nestedRefs: NestedRef[], relPath: string): string {
  const result: string[] = [];
  let i = 0;
  for (const nested of nestedRefs) {
    result.push(...lines.slice(i, nested.startIdx));
    result.push(`${nested.prefix}<<@SPOOL: ${relPath}#${nested.name}>>`);
    i = nested.endIdx;
  }
  result.push(...lines.slice(i));
  return result.join("\n");
}

export async function buildRegistries(
  projectRoot: string,
  config: SpoolConfig,
): Promise<{
  registry: PassageRegistry;
  templateRegistry: PassageTemplateRegistry;
  errors: FileErrors[];
}> {
  const registry: PassageRegistry = new Map();
  const templateRegistry: PassageTemplateRegistry = new Map();
  const allErrors: FileErrors[] = [];
  const sourceDir = join(projectRoot, config.sourceCodeDir);
  const docsDir = join(projectRoot, config.sourceDocsDir);

  const excludeGlobs = (config.excludePatterns ?? []).map((p) => new Glob(p));

  const glob = new Glob("**/*");
  for await (const entry of glob.scan({ cwd: sourceDir, dot: false })) {
    const fullPath = join(sourceDir, entry);
    const relPath = relative(projectRoot, fullPath);

    // Skip sourceDocsDir
    if (fullPath.startsWith(docsDir)) {
      continue;
    }

    // Skip excluded patterns
    if (excludeGlobs.some((g) => g.match(relPath))) {
      continue;
    }

    // Skip binary-looking files and directories
    try {
      const content = await readFile(fullPath, "utf-8");
      if (content.includes("\0")) {
        continue;
      }

      const { passages, passageNestedRefs, errors } = parseSourcePassages(content);

      if (errors.length > 0) {
        allErrors.push({ filePath: relPath, errors });
      }
      for (const [name, value] of passages) {
        const key = `${relPath}:${name}`;
        registry.set(key, value);

        const nestedRefs = passageNestedRefs.get(name) ?? [];
        if (nestedRefs.length > 0) {
          templateRegistry.set(key, buildTemplateContent(value.split("\n"), nestedRefs, relPath));
        } else {
          templateRegistry.set(key, value);
        }
      }
    } catch {
      // Skip files that can't be read as text
      continue;
    }
  }

  return { registry, templateRegistry, errors: allErrors };
}
