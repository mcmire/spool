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
};

// == ::SPOOL:: start(#lintProject) ==
export async function lintProject(projectRoot: string, config: SpoolConfig): Promise<LintResult> {
  const {
    registry,
    passagePositions,
    errors: registryErrors,
  } = await buildRegistries(projectRoot, config);

  const docErrors: FileErrors[] = [];
  const docsDir = join(projectRoot, config.source.docs);

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
      }
    }

    if (errors.length > 0) {
      const relPath = relative(projectRoot, fullPath);
      docErrors.push({ filePath: relPath, errors });
    }
  }

  return { registryErrors, docErrors };
}
// == ::SPOOL:: end(#lintProject) ==
