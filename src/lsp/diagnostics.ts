import { DiagnosticSeverity } from "vscode-languageserver/node.js";
import type { Diagnostic } from "vscode-languageserver/node.js";
import { parseSourcePassages, parsePassageReferences, VALID_MODIFIERS } from "../parser.ts";
import type { PassageRegistry, PassageTemplateRegistry } from "../registries.ts";

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

export function getDocFileDiagnostics(
  content: string,
  registry: PassageRegistry,
  templateRegistry: PassageTemplateRegistry,
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
    const key = `${ref.filePath}:${ref.passageName}`;
    const source = ref.modifier === "no-expand-nested" ? templateRegistry : registry;
    if (!source.has(key)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line: ref.line - 1, character: ref.column - 1 },
          end: {
            line: ref.line - 1,
            character: ref.column - 1 + ref.raw.length,
          },
        },
        message: `Unknown reference: ${ref.raw}`,
        source: "spool",
      });
    }
  }

  return diagnostics;
}
