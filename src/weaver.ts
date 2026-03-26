import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, posix } from "node:path";
import fg from "fast-glob";
import type { ParseError, RangeMarker } from "./parser.ts";
import { parsePassageReferences, VALID_MODIFIERS } from "./parser.ts";
import type {
  PassageRegistry,
  PassageTemplateRegistry,
  PassagePositions,
  FilePositions,
  FileErrors,
} from "./registries.ts";
import { WHOLE_FILE_KEY as WHOLE_FILE_KEY_VAL } from "./registries.ts";
import { buildRegistries } from "./registries.ts";
import type { SpoolConfig } from "./config.ts";

// Returns a 1-indexed line number; caller uses slice(value - 1, ...) to get 0-indexed start.
function resolveStartMarker(marker: RangeMarker, positions: FilePositions): number | undefined {
  switch (marker.type) {
    case "START":
      return positions.get(WHOLE_FILE_KEY_VAL)?.startLine;
    case "END":
      return positions.get(WHOLE_FILE_KEY_VAL)?.endLine;
    case "start":
      return positions.get(marker.passageName)?.startLine;
    case "end":
      return positions.get(marker.passageName)?.endLine;
  }
}

// Returns a 0-indexed exclusive upper bound for slice(..., value).
// start(#name) and end(#name) store 1-indexed line numbers, so subtract 1 to get
// the exclusive index that stops just before the named passage boundary.
function resolveEndMarker(marker: RangeMarker, positions: FilePositions): number | undefined {
  switch (marker.type) {
    case "START": {
      const pos = positions.get(WHOLE_FILE_KEY_VAL);
      return pos !== undefined ? 0 : undefined;
    }
    case "END":
      return positions.get(WHOLE_FILE_KEY_VAL)?.endLine;
    case "start": {
      const startLine = positions.get(marker.passageName)?.startLine;
      return startLine !== undefined ? startLine - 1 : undefined;
    }
    case "end": {
      const endLine = positions.get(marker.passageName)?.endLine;
      return endLine !== undefined ? endLine - 1 : undefined;
    }
  }
}

export function weaveFile(
  docContent: string,
  registry: PassageRegistry,
  templateRegistry: PassageTemplateRegistry,
  passagePositions: PassagePositions,
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

    const fullPath = posix.join(sourceDir, ref.filePath);
    const positions = passagePositions.get(fullPath);
    const wholeFileKey = `${fullPath}:`;
    const wholeFileContent = registry.get(wholeFileKey);

    if (ref.isRange && ref.rangeStart && ref.rangeEnd) {
      if (!positions || !wholeFileContent) {
        errors.push({
          line: ref.line,
          column: ref.column,
          message: `Unknown reference: ${ref.raw}`,
        });
        continue;
      }

      const startLine = resolveStartMarker(ref.rangeStart, positions);
      const endLine = resolveEndMarker(ref.rangeEnd, positions);

      if (startLine === undefined) {
        errors.push({
          line: ref.line,
          column: ref.column,
          message: `Unknown passage in range start: ${ref.rangeStart.type === "start" || ref.rangeStart.type === "end" ? "#" + ref.rangeStart.passageName : ref.rangeStart.type}`,
        });
        continue;
      }

      if (endLine === undefined) {
        errors.push({
          line: ref.line,
          column: ref.column,
          message: `Unknown passage in range end: ${ref.rangeEnd.type === "start" || ref.rangeEnd.type === "end" ? "#" + ref.rangeEnd.passageName : ref.rangeEnd.type}`,
        });
        continue;
      }

      const wholeLines = wholeFileContent.split("\n");
      const rangeContent = wholeLines.slice(startLine - 1, endLine).join("\n");
      lines[ref.line - 1] = rangeContent;
      continue;
    }

    const key = ref.passageName !== undefined ? `${fullPath}:${ref.passageName}` : wholeFileKey;
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
    passagePositions,
    errors: registryErrors,
  } = await buildRegistries(projectRoot, config);

  const docsDir = join(projectRoot, config.source.docs);
  const targetDir = join(projectRoot, config.target);
  const weaveErrors: FileErrors[] = [];
  let filesProcessed = 0;
  let filesWritten = 0;

  const entries = await fg("**/*.md", { cwd: docsDir });
  for (const entry of entries) {
    filesProcessed++;
    const fullPath = join(docsDir, entry);
    const content = await readFile(fullPath, "utf-8");
    const { output, errors } = weaveFile(
      content,
      registry,
      templateRegistry,
      passagePositions,
      config.source.code,
    );

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
