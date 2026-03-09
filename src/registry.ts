import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Glob } from "bun";
import type { ParseError } from "./parser.ts";
import { parseSourceBlocks } from "./parser.ts";
import type { SpoolConfig } from "./config.ts";

export type BlockRegistry = Map<string, string>;

export type FileErrors = {
  filePath: string;
  errors: ParseError[];
};

export async function buildRegistry(
  projectRoot: string,
  config: SpoolConfig,
): Promise<{ registry: BlockRegistry; errors: FileErrors[] }> {
  const registry: BlockRegistry = new Map();
  const allErrors: FileErrors[] = [];
  const sourceDir = join(projectRoot, config.sourceCodeDir);
  const docsDir = join(projectRoot, config.sourceDocsDir);

  const glob = new Glob("**/*");
  for await (const entry of glob.scan({ cwd: sourceDir, dot: false })) {
    const fullPath = join(sourceDir, entry);

    // Skip sourceDocsDir
    if (fullPath.startsWith(docsDir)) {
      continue;
    }

    // Skip binary-looking files and directories
    try {
      const content = await readFile(fullPath, "utf-8");
      if (content.includes("\0")) {
        continue;
      }

      const { blocks, errors } = parseSourceBlocks(content);

      if (errors.length > 0) {
        const relPath = relative(projectRoot, fullPath);
        allErrors.push({ filePath: relPath, errors });
      }

      const relPath = relative(projectRoot, fullPath);
      for (const [name, value] of blocks) {
        registry.set(`${relPath}:${name}`, value);
      }
    } catch {
      // Skip files that can't be read as text
      continue;
    }
  }

  return { registry, errors: allErrors };
}
