import { readFile } from "node:fs/promises";
import { join, extname, relative } from "node:path";
import fg from "fast-glob";
import type { ParseError } from "../../parser.ts";
import { parsePassageReferences, VALID_MODIFIERS } from "../../parser.ts";
import type {
  PassageRegistry,
  PassageTemplateRegistry,
  PassagePositions,
  FileErrors,
} from "../../registries.ts";
import { buildRegistries } from "../../registries.ts";
import { resolveStartMarker, resolveEndMarker } from "../../weaver.ts";
import type { SpoolConfig } from "../../config.ts";
import type { PassageLocationMap } from "./reference-map.ts";
import {
  buildReferenceMap,
  verifyUniqueReferences,
  buildPassageLocationMap,
  referenceKey,
  passageAnchorId,
} from "./reference-map.ts";

const EXTENSION_LANG_MAP: Record<string, string> = {
  ".ts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".jsx": "jsx",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp",
  ".css": "css",
  ".html": "html",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "zsh",
  ".sql": "sql",
  ".md": "md",
  ".xml": "xml",
  ".toml": "toml",
  ".lua": "lua",
  ".swift": "swift",
  ".kt": "kotlin",
  ".scala": "scala",
  ".ex": "elixir",
  ".exs": "elixir",
  ".hs": "haskell",
  ".ml": "ocaml",
  ".vim": "vim",
};

export function inferLang(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return EXTENSION_LANG_MAP[ext] ?? ext.slice(1);
}

function wrapPassage(content: string, filePath: string, anchorId: string | undefined): string {
  const lang = inferLang(filePath);
  const anchorAttr = anchorId ? ` anchor="${anchorId}"` : "";
  return `<SpoolPassage${anchorAttr}>\n\n\`\`\`${lang}\n${content}\n\`\`\`\n\n</SpoolPassage>`;
}

// ::SPOOL:: ignore-next
// When a passage reference is written inside a doc code fence (e.g. ```ts\n// ::SPOOL:: ...\n```),
// the outer fence delimiters are redundant once we wrap the content in <SpoolPassage>. This
// function blanks out those delimiter lines so they don't appear in the rendered output.
function clearSurroundingFence(lines: string[], refLineIndex: number): void {
  const prevLine = lines[refLineIndex - 1];
  const nextLine = lines[refLineIndex + 1];
  if (prevLine !== undefined && /^```/.test(prevLine)) {
    lines[refLineIndex - 1] = "";
  }
  if (nextLine !== undefined && /^```$/.test(nextLine)) {
    lines[refLineIndex + 1] = "";
  }
}

export function weaveSiteFile(
  docContent: string,
  registry: PassageRegistry,
  templateRegistry: PassageTemplateRegistry,
  passagePositions: PassagePositions,
  passageLocationMap: PassageLocationMap | undefined,
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

    const fullPath = ref.filePath;
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
      const refKey = referenceKey(ref.filePath, undefined, ref.rangeStart, ref.rangeEnd);
      const anchorId = passageLocationMap?.get(refKey)?.anchorId;
      clearSurroundingFence(lines, ref.line - 1);
      lines[ref.line - 1] = wrapPassage(rangeContent, ref.filePath, anchorId);
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
      const refKey = referenceKey(ref.filePath, ref.passageName);
      const anchorId = passageLocationMap?.get(refKey)?.anchorId;
      clearSurroundingFence(lines, ref.line - 1);
      lines[ref.line - 1] = wrapPassage(passageContent, ref.filePath, anchorId);
    }
  }

  return { output: lines.join("\n"), errors };
}

export type WeaveSiteOptions = {
  verifyUniqueReferences?: boolean;
  linkReferences?: boolean;
};

export type WeaveSiteResult = {
  filesProcessed: number;
  files: Map<string, string>;
  registryErrors: FileErrors[];
  weaveErrors: FileErrors[];
  referenceErrors: FileErrors[];
  passageLocationMap: PassageLocationMap;
};

export async function weaveSiteFiles(
  projectRoot: string,
  config: SpoolConfig,
  options: WeaveSiteOptions = {},
): Promise<WeaveSiteResult> {
  const {
    registry,
    templateRegistry,
    passagePositions,
    errors: registryErrors,
  } = await buildRegistries(projectRoot, config);

  const docsDir = join(projectRoot, config.source.docs);
  const weaveErrors: FileErrors[] = [];
  const referenceErrors: FileErrors[] = [];
  const files: Map<string, string> = new Map();
  let filesProcessed = 0;

  // Read all doc files into memory
  const rawDocContents: Map<string, string> = new Map();
  const entries = await fg("**/*.md", { cwd: docsDir });
  for (const entry of entries) {
    const fullPath = join(docsDir, entry);
    const content = await readFile(fullPath, "utf-8");
    rawDocContents.set(entry, content);
  }

  // Build reference map and verify uniqueness if requested
  let passageLocationMap: PassageLocationMap = new Map();

  if (options.verifyUniqueReferences || options.linkReferences) {
    const refMap = buildReferenceMap(rawDocContents);
    const uniqueErrors = verifyUniqueReferences(refMap);
    if (uniqueErrors.length > 0) {
      referenceErrors.push({ filePath: "(cross-file)", errors: uniqueErrors });
    }

    if (options.linkReferences) {
      passageLocationMap = buildPassageLocationMap(refMap);
    }
  }

  // Weave each doc file with Vue component wrapping
  for (const [entry, content] of rawDocContents) {
    filesProcessed++;
    const { output, errors } = weaveSiteFile(
      content,
      registry,
      templateRegistry,
      passagePositions,
      options.linkReferences ? passageLocationMap : undefined,
    );

    if (errors.length > 0) {
      const relPath = relative(projectRoot, join(docsDir, entry));
      weaveErrors.push({ filePath: relPath, errors });
    }

    files.set(entry.replace(/(^|\/)README\.md$/, "$1index.md"), output);
  }

  return {
    filesProcessed,
    files,
    registryErrors,
    weaveErrors,
    referenceErrors,
    passageLocationMap,
  };
}
