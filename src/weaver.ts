import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { Glob } from "bun";
import type { ParseError } from "./parser.ts";
import { parsePassageReferences, VALID_MODIFIERS } from "./parser.ts";
import type { PassageRegistry, PassageTemplateRegistry, FileErrors } from "./registries.ts";
import { buildRegistries } from "./registries.ts";
import type { SpoolConfig } from "./config.ts";

export function weaveFile(
  docContent: string,
  registry: PassageRegistry,
  templateRegistry: PassageTemplateRegistry,
): { output: string; errors: ParseError[] } {
  const { refs, errors } = parsePassageReferences(docContent);

  let output = docContent;
  // Replace in reverse order to preserve positions
  const sortedRefs = [...refs].sort((a, b) => {
    if (a.line !== b.line) {
      return b.line - a.line;
    }
    return b.column - a.column;
  });

  for (const ref of sortedRefs) {
    if (ref.modifier !== undefined && !VALID_MODIFIERS.has(ref.modifier)) {
      errors.push({
        line: ref.line,
        column: ref.column,
        message: `Unknown modifier: ${ref.modifier}`,
      });
      continue;
    }
    const key = `${ref.filePath}:${ref.passageName}`;
    const source = ref.modifier === "no-expand-nested" ? templateRegistry : registry;
    const passageContent = source.get(key);
    if (passageContent === undefined) {
      errors.push({
        line: ref.line,
        column: ref.column,
        message: `Unknown reference: ${ref.raw}`,
      });
    } else {
      output = output.replace(ref.raw, passageContent);
    }
  }

  return { output, errors };
}

export type WeaveResult = {
  filesProcessed: number;
  filesWritten: number;
  registryErrors: FileErrors[];
  weaveErrors: FileErrors[];
};

export async function weaveProject(
  projectRoot: string,
  config: SpoolConfig,
): Promise<WeaveResult> {
  const { registry, templateRegistry, errors: registryErrors } = await buildRegistries(
    projectRoot,
    config,
  );

  const docsDir = join(projectRoot, config.sourceDocsDir);
  const targetDir = join(projectRoot, config.targetDocsDir);
  const weaveErrors: FileErrors[] = [];
  let filesProcessed = 0;
  let filesWritten = 0;

  const glob = new Glob("**/*.md");
  for await (const entry of glob.scan({ cwd: docsDir })) {
    filesProcessed++;
    const fullPath = join(docsDir, entry);
    const content = await readFile(fullPath, "utf-8");
    const { output, errors } = weaveFile(content, registry, templateRegistry);

    if (errors.length > 0) {
      const relPath = relative(projectRoot, fullPath);
      weaveErrors.push({ filePath: relPath, errors });
    }

    const targetPath = join(targetDir, entry);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, output, "utf-8");
    filesWritten++;
  }

  return { filesProcessed, filesWritten, registryErrors, weaveErrors };
}
