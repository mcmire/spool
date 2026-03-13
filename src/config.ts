import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export type SpoolConfig = {
  sourceCodeDir: string;
  sourceDocsDir: string;
  targetDocsDir: string;
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

  for (const field of ["sourceCodeDir", "sourceDocsDir", "targetDocsDir"]) {
    if (typeof parsed[field] !== "string") {
      throw new Error(`Missing or invalid field "${field}" in ${CONFIG_FILE}`);
    }
  }

  return {
    sourceCodeDir: parsed.sourceCodeDir as string,
    sourceDocsDir: parsed.sourceDocsDir as string,
    targetDocsDir: parsed.targetDocsDir as string,
  };
}
