import { DiagnosticSeverity } from "vscode-languageserver/node.js";
import type { Diagnostic } from "vscode-languageserver/node.js";
import { parseSourcePassages, parsePassageReferences, VALID_MODIFIERS } from "../../parser.ts";
import { WHOLE_FILE_KEY } from "../../registries.ts";
import type {
  PassageRegistry,
  PassageTemplateRegistry,
  PassagePositions,
} from "../../registries.ts";

export function getSourceFileDiagnostics(content: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { errors } = parseSourcePassages(content);
  for (const error of errors) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: error.line - 1, character: error.column - 1 },
        end: {
          line: error.line - 1,
          character: error.column - 1 + (error.length ?? 0),
        },
      },
      message: error.message,
      source: "spool",
    });
  }
  return diagnostics;
}

function fileExistsInRegistry(
  filePath: string,
  source: PassageRegistry | PassageTemplateRegistry,
): boolean {
  const prefix = `${filePath}:`;
  for (const key of source.keys()) {
    if (key.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function resolveMarker(
  marker: { type: string; passageName?: string },
  positions: Map<string, { startLine: number; endLine: number }> | undefined,
): boolean {
  if (!positions) {
    return false;
  }
  switch (marker.type) {
    case "START":
    case "END":
      return positions.has(WHOLE_FILE_KEY);
    case "start":
    case "end":
      return marker.passageName !== undefined && positions.has(marker.passageName);
    default:
      return false;
  }
}

export function getDocFileDiagnostics(
  content: string,
  registry: PassageRegistry,
  templateRegistry: PassageTemplateRegistry,
  passagePositions: PassagePositions,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { refs, errors: refErrors } = parsePassageReferences(content);

  for (const error of refErrors) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: error.line - 1, character: error.column - 1 },
        end: {
          line: error.line - 1,
          character: error.column - 1 + (error.length ?? 0),
        },
      },
      message: error.message,
      source: "spool",
    });
  }

  for (const ref of refs) {
    if (ref.modifier !== undefined && !VALID_MODIFIERS.has(ref.modifier)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: ref.line - 1, character: ref.column - 1 },
          end: {
            line: ref.line - 1,
            character: ref.column - 1 + ref.raw.length,
          },
        },
        message: `Unknown modifier: ${ref.modifier}`,
        source: "spool",
      });
      continue;
    }

    if (ref.isRange && ref.rangeStart && ref.rangeEnd) {
      const positions = passagePositions.get(ref.filePath);
      const wholeFileKey = `${ref.filePath}:`;
      if (!registry.has(wholeFileKey)) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: ref.line - 1, character: ref.column - 1 },
            end: {
              line: ref.line - 1,
              character: ref.column - 1 + ref.raw.length,
            },
          },
          message: `Unknown file: ${ref.filePath}`,
          source: "spool",
        });
        continue;
      }

      if (!resolveMarker(ref.rangeStart, positions)) {
        const markerStr =
          ref.rangeStart.type === "start" || ref.rangeStart.type === "end"
            ? `#${ref.rangeStart.passageName}`
            : ref.rangeStart.type;
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: ref.line - 1, character: ref.column - 1 },
            end: {
              line: ref.line - 1,
              character: ref.column - 1 + ref.raw.length,
            },
          },
          message: `Unknown passage "${markerStr}" in file ${ref.filePath}`,
          source: "spool",
        });
      }

      if (!resolveMarker(ref.rangeEnd, positions)) {
        const markerStr =
          ref.rangeEnd.type === "start" || ref.rangeEnd.type === "end"
            ? `#${ref.rangeEnd.passageName}`
            : ref.rangeEnd.type;
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: ref.line - 1, character: ref.column - 1 },
            end: {
              line: ref.line - 1,
              character: ref.column - 1 + ref.raw.length,
            },
          },
          message: `Unknown passage "${markerStr}" in file ${ref.filePath}`,
          source: "spool",
        });
      }
      continue;
    }

    const key =
      ref.passageName !== undefined ? `${ref.filePath}:${ref.passageName}` : `${ref.filePath}:`;
    const source = ref.modifier === "no-expand-nested" ? templateRegistry : registry;
    if (!source.has(key)) {
      const message =
        ref.passageName !== undefined && fileExistsInRegistry(ref.filePath, source)
          ? `Unknown passage ID "${ref.passageName}" in file ${ref.filePath}`
          : `Unknown file: ${ref.filePath}`;
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: ref.line - 1, character: ref.column - 1 },
          end: {
            line: ref.line - 1,
            character: ref.column - 1 + ref.raw.length,
          },
        },
        message,
        source: "spool",
      });
    }
  }

  return diagnostics;
}
