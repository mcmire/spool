import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import fg from "fast-glob";
import type { SpoolConfig } from "../../config.ts";
import { parsePassageReferences } from "../../parser.ts";
import { buildRegistries } from "../../registries.ts";
import type { FileErrors, PassagePositions } from "../../registries.ts";

export type LintResult = {
  registryErrors: FileErrors[];
  docErrors: FileErrors[];
  unmarkedFiles?: string[];
  unreferencedPassages?: Array<{ filePath: string; passageName: string }>;
};

// == ::SPOOL:: start(#lintProject) ==
export async function lintProject(
  projectRoot: string,
  config: SpoolConfig,
  options: { coverage?: boolean } = {},
): Promise<LintResult> {
  const {
    registry,
    passagePositions,
    errors: registryErrors,
  } = await buildRegistries(projectRoot, config);

  const docErrors: FileErrors[] = [];
  const docsDir = join(projectRoot, config.source.docs);
  const referencedPassageKeys = new Set<string>();
  const wholeFileReferencedPaths = new Set<string>();

  const entries = await fg("**/*.md", { cwd: docsDir });
  for (const entry of entries) {
    const fullPath = join(docsDir, entry);
    const content = await readFile(fullPath, "utf-8");
    const { refs } = parsePassageReferences(content);

    const errors = [];
    for (const ref of refs) {
      const fileRelPath = ref.filePath;
      if (ref.isRange) {
        const wholeFileKey = `${fileRelPath}:`;
        if (!registry.has(wholeFileKey)) {
          errors.push({
            line: ref.line,
            column: ref.column,
            message: `Unknown reference: ${ref.raw}`,
          });
          continue;
        }
        const filePositions = passagePositions.get(fileRelPath);
        if (filePositions && ref.rangeStart && ref.rangeEnd) {
          for (const marker of [ref.rangeStart, ref.rangeEnd]) {
            if (
              (marker.type === "start" || marker.type === "end") &&
              !filePositions.has(marker.passageName)
            ) {
              errors.push({
                line: ref.line,
                column: ref.column,
                message: `Unknown passage in range: #${marker.passageName}`,
              });
            }
          }
        }
        continue;
      }
      const key = `${fileRelPath}:${ref.passageName ?? ""}`;
      if (!registry.has(key)) {
        errors.push({
          line: ref.line,
          column: ref.column,
          message: `Unknown reference: ${ref.raw}`,
        });
      } else if (options.coverage) {
        if (ref.passageName) {
          referencedPassageKeys.add(key);
        } else {
          wholeFileReferencedPaths.add(fileRelPath);
        }
      }
    }

    if (errors.length > 0) {
      const relPath = relative(projectRoot, fullPath);
      docErrors.push({ filePath: relPath, errors });
    }
  }

  if (!options.coverage) {
    return { registryErrors, docErrors };
  }

  const filesWithPassages = new Set<string>();
  const allNamedPassageKeys: string[] = [];
  for (const key of registry.keys()) {
    const colonIdx = key.indexOf(":");
    const passageName = key.slice(colonIdx + 1);
    if (passageName !== "") {
      const filePath = key.slice(0, colonIdx);
      filesWithPassages.add(filePath);
      allNamedPassageKeys.push(key);
    }
  }

  const unmarkedFiles: string[] = [];
  for (const relPath of passagePositions.keys()) {
    if (!filesWithPassages.has(relPath) && !wholeFileReferencedPaths.has(relPath)) {
      unmarkedFiles.push(relPath);
    }
  }
  unmarkedFiles.sort();

  const unreferencedPassages: Array<{ filePath: string; passageName: string }> = [];
  for (const key of allNamedPassageKeys) {
    if (!referencedPassageKeys.has(key)) {
      const colonIdx = key.indexOf(":");
      const filePath = key.slice(0, colonIdx);
      if (!wholeFileReferencedPaths.has(filePath)) {
        unreferencedPassages.push({
          filePath,
          passageName: key.slice(colonIdx + 1),
        });
      }
    }
  }
  unreferencedPassages.sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || a.passageName.localeCompare(b.passageName),
  );

  return { registryErrors, docErrors, unmarkedFiles, unreferencedPassages };
}
// == ::SPOOL:: end(#lintProject) ==
