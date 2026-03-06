import * as fs from "node:fs";
import * as path from "node:path";
import type { SuperLSConfig, LanguageServerConfig } from "./types.js";

const LANGUAGE_EXTENSION_MAP: Record<string, string> = {
  typescript: ".ts",
  javascript: ".js",
  typescriptreact: ".tsx",
  javascriptreact: ".jsx",
  python: ".py",
  go: ".go",
  rust: ".rs",
  ruby: ".rb",
  java: ".java",
  c: ".c",
  cpp: ".cpp",
  csharp: ".cs",
  css: ".css",
  html: ".html",
  json: ".json",
  yaml: ".yml",
  toml: ".toml",
  lua: ".lua",
  swift: ".swift",
  kotlin: ".kt",
  scala: ".scala",
  shell: ".sh",
  bash: ".sh",
  sh: ".sh",
  sql: ".sql",
  php: ".php",
  zig: ".zig",
  elixir: ".ex",
  haskell: ".hs",
  ocaml: ".ml",
  ts: ".ts",
  js: ".js",
  tsx: ".tsx",
  jsx: ".jsx",
  py: ".py",
  rb: ".rb",
  rs: ".rs",
};

export function getExtensionForLanguage(language: string): string {
  return LANGUAGE_EXTENSION_MAP[language.toLowerCase()] ?? `.${language.toLowerCase()}`;
}

/**
 * Normalize language aliases to canonical form for server config lookup.
 */
export function normalizeLanguage(language: string): string {
  const aliases: Record<string, string> = {
    ts: "typescript",
    js: "javascript",
    tsx: "typescriptreact",
    jsx: "javascriptreact",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "shell",
    bash: "shell",
  };
  return aliases[language.toLowerCase()] ?? language.toLowerCase();
}

export function loadConfig(
  workspaceRoot: string | undefined,
  initOptions?: Partial<SuperLSConfig>,
): SuperLSConfig {
  // initializationOptions take precedence
  if (initOptions?.servers && Object.keys(initOptions.servers).length > 0) {
    return { servers: initOptions.servers };
  }

  // Try to load from .superlsconfig.json
  if (workspaceRoot) {
    const configPath = path.join(workspaceRoot, ".superlsconfig.json");
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as SuperLSConfig;
      return parsed;
    }
  }

  return { servers: {} };
}

export function getServerConfig(
  config: SuperLSConfig,
  language: string,
): LanguageServerConfig | undefined {
  const normalized = normalizeLanguage(language);
  return config.servers[normalized] ?? config.servers[language];
}
