import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, posix } from "node:path";
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
  sourceDir: string,
): { output: string; errors: ParseError[] } {
  const { refs, errors } = parsePassageReferences(docContent);
  const lines = docContent.split("\n");

  for (const ref of refs) {
    if (ref.modifier !== undefined && !VALID_MODIFIERS.has(ref.modifier)) {
      errors.push({
        line: ref.line,
        column: ref.column,
        message: `Unknown modifier: ${ref.modifier}`,
      });
      continue;
    }
    const key = `${posix.join(sourceDir, ref.filePath)}:${ref.passageName}`;
    const source = ref.modifier === "no-expand-nested" ? templateRegistry : registry;
    const passageContent = source.get(key);
    if (passageContent === undefined) {
      errors.push({
        line: ref.line,
        column: ref.column,
        message: `Unknown reference: ${ref.raw}`,
      });
    } else {
      lines[ref.line - 1] = passageContent;
    }
  }

  return { output: lines.join("\n"), errors };
}

export type WeaveResult = {
  filesProcessed: number;
  filesWritten: number;
  registryErrors: FileErrors[];
  weaveErrors: FileErrors[];
};

export async function weaveProject(projectRoot: string, config: SpoolConfig): Promise<WeaveResult> {
  const {
    registry,
    templateRegistry,
    errors: registryErrors,
  } = await buildRegistries(projectRoot, config);

  const docsDir = join(projectRoot, config.source.docs);
  const targetDir = join(projectRoot, config.target);
  const weaveErrors: FileErrors[] = [];
  let filesProcessed = 0;
  let filesWritten = 0;

  const glob = new Glob("**/*.md");
  for await (const entry of glob.scan({ cwd: docsDir })) {
    filesProcessed++;
    const fullPath = join(docsDir, entry);
    const content = await readFile(fullPath, "utf-8");
    const { output, errors } = weaveFile(content, registry, templateRegistry, config.source.code);

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
