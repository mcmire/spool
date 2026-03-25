import { watch } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, loadConfig } from "../../config.ts";
import type { SpoolConfig } from "../../config.ts";
import { weaveProjectInMemory } from "../../weaver.ts";
import type { FileErrors } from "../../registries.ts";
import {
  prepareSiteDir,
  writeWovenFiles,
  writeVitePressConfig,
  startDevServer,
  buildSite,
} from "./vitepress.ts";

type Writable = { write(s: string): void };

export type SiteDevCommandOptions = {
  cwd: string;
  stdout: Writable;
  stderr: Writable;
  port?: string;
};

export type SiteDevCommandResult = {
  server: { port: number; stop(): Promise<void> };
};

export type SiteBuildCommandOptions = {
  cwd: string;
  stdout: Writable;
  stderr: Writable;
};

export type SiteBuildCommandResult = {
  exitCode?: number;
};

function printErrors(fileErrors: FileErrors[], stderr: Writable): void {
  for (const { filePath, errors } of fileErrors) {
    for (const error of errors) {
      stderr.write(`  ${filePath}:${error.line}:${error.column}: ${error.message}\n`);
    }
  }
}

export async function siteDevCommand({
  cwd,
  stdout,
  stderr,
  port: portOption,
}: SiteDevCommandOptions): Promise<SiteDevCommandResult> {
  const projectRoot = findProjectRoot(cwd);
  const config = await loadConfig(projectRoot);

  const result = await weaveProjectInMemory(projectRoot, config);
  stdout.write(`Initial weave: ${result.files.size} file(s) written.\n`);

  await prepareSiteDir(projectRoot);
  await writeWovenFiles(projectRoot, result.files);
  await writeVitePressConfig(projectRoot, config);

  const siteDir = join(projectRoot, ".site");
  const startPort = portOption ? parseInt(portOption, 10) : 5173;
  const server = await startDevServer(siteDir, startPort);

  stdout.write(`Dev server running at http://localhost:${server.port}\n`);

  const sourceDir = join(projectRoot, config.source.code);
  const docsDir = join(projectRoot, config.source.docs);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleReweave(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(async () => {
      try {
        const r = await weaveProjectInMemory(projectRoot, config);
        await writeWovenFiles(projectRoot, r.files);
        stdout.write(`Re-wove: ${r.files.size} file(s) written.\n`);
      } catch (err) {
        stderr.write(`Re-weave failed: ${err}\n`);
      }
    }, 200);
  }

  watch(sourceDir, { recursive: true }, (_event, filename) => {
    if (filename) {
      scheduleReweave();
    }
  });

  if (!docsDir.startsWith(sourceDir)) {
    watch(docsDir, { recursive: true }, (_event, filename) => {
      if (filename) {
        scheduleReweave();
      }
    });
  }

  return { server };
}

export async function siteBuildCommand({
  cwd,
  stdout,
  stderr,
}: SiteBuildCommandOptions): Promise<SiteBuildCommandResult> {
  const projectRoot = findProjectRoot(cwd);
  const config = await loadConfig(projectRoot);

  const result = await weaveProjectInMemory(projectRoot, config);
  stdout.write(`Initial weave: ${result.files.size} file(s) written.\n`);

  const hasErrors = result.registryErrors.length > 0 || result.weaveErrors.length > 0;

  if (hasErrors) {
    if (result.registryErrors.length > 0) {
      stderr.write("\nSource file errors:\n");
      printErrors(result.registryErrors, stderr);
    }
    if (result.weaveErrors.length > 0) {
      stderr.write("\nWeave errors:\n");
      printErrors(result.weaveErrors, stderr);
    }
    return { exitCode: 1 };
  }

  await prepareSiteDir(projectRoot);
  await writeWovenFiles(projectRoot, result.files);
  await writeVitePressConfig(projectRoot, config);

  const siteDir = join(projectRoot, ".site");
  await buildSite(siteDir);

  stdout.write("Site built successfully.\n");
  return {};
}
