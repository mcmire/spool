import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type SpoolConfig = {
  source: {
    code: string;
    docs: string;
    excludeFromCode?: string[];
  };
  target: string;
  site?: Record<string, unknown>;
};

const CONFIG_FILE = "spool.json";

export function findProjectRoot(startDir: string): string {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, CONFIG_FILE))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find ${CONFIG_FILE} in ${startDir} or any parent directory`);
    }
    dir = parent;
  }
}

export async function loadConfig(projectRoot: string): Promise<SpoolConfig> {
  const configPath = join(projectRoot, CONFIG_FILE);
  const raw = await readFile(configPath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const source = parsed.source as Record<string, unknown> | undefined;
  const code = source?.code;
  const docs = source?.docs;
  const target = parsed.target;

  if (!source || typeof docs !== "string" || typeof target !== "string") {
    throw new Error(`Missing or invalid fields in ${CONFIG_FILE}`);
  }

  let sourceCodeDir: string;
  let excludeFromCode: string[] | undefined;

  if (typeof code === "string") {
    sourceCodeDir = code;
  } else if (Array.isArray(code) && code.length > 0 && typeof code[0] === "string") {
    sourceCodeDir = code[0];
    const patterns = (code as string[])
      .slice(1)
      .filter((e) => e.startsWith("!"))
      .map((e) => e.slice(1));
    if (patterns.length > 0) {
      excludeFromCode = patterns;
    }
  } else {
    throw new Error(`Missing or invalid "source.code" in ${CONFIG_FILE}`);
  }

  return {
    source: { code: sourceCodeDir, docs, excludeFromCode },
    target,
    ...(parsed.site !== undefined && {
      site: parsed.site as Record<string, unknown>,
    }),
  };
}
