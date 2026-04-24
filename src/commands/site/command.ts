import { watch } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, loadConfig } from "../../config.ts";
import type { FileErrors } from "../../registries.ts";
import {
  prepareSiteDir,
  writeWovenFiles,
  writeVitePressConfig,
  writeVitePressTheme,
  startDevServer,
  buildSite,
} from "./vitepress.ts";
import { weaveSiteFiles } from "./weave-site.ts";
import type { WeaveSiteOptions } from "./weave-site.ts";

type Writable = { write(s: string): void };

export type SiteDevCommandOptions = {
  cwd: string;
  stdout: Writable;
  stderr: Writable;
  port?: string;
  verifyUniqueReferences?: boolean;
  linkReferences?: boolean;
};

export type SiteDevCommandResult = {
  server: { port: number; stop(): Promise<void> };
};

export type SiteBuildCommandOptions = {
  cwd: string;
  stdout: Writable;
  stderr: Writable;
  verifyUniqueReferences?: boolean;
  linkReferences?: boolean;
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
  verifyUniqueReferences,
  linkReferences,
}: SiteDevCommandOptions): Promise<SiteDevCommandResult> {
  const projectRoot = findProjectRoot(cwd);
  const config = await loadConfig(projectRoot);
  const weaveOptions: WeaveSiteOptions = { verifyUniqueReferences, linkReferences };

  const result = await weaveSiteFiles(projectRoot, config, weaveOptions);
  stdout.write(`Initial weave: ${result.files.size} file(s) written.\n`);

  await prepareSiteDir(projectRoot);
  await writeWovenFiles(projectRoot, result.files);
  await writeVitePressConfig(projectRoot, config, {
    linkReferences,
    passageLocationMap: result.passageLocationMap,
  });
  await writeVitePressTheme(projectRoot);

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
        const r = await weaveSiteFiles(projectRoot, config, weaveOptions);
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
  verifyUniqueReferences,
  linkReferences,
}: SiteBuildCommandOptions): Promise<SiteBuildCommandResult> {
  const projectRoot = findProjectRoot(cwd);
  const config = await loadConfig(projectRoot);

  const result = await weaveSiteFiles(projectRoot, config, {
    verifyUniqueReferences,
    linkReferences,
  });
  stdout.write(`Initial weave: ${result.files.size} file(s) written.\n`);

  const hasErrors =
    result.registryErrors.length > 0 ||
    result.weaveErrors.length > 0 ||
    result.referenceErrors.length > 0;

  if (hasErrors) {
    if (result.registryErrors.length > 0) {
      stderr.write("\nSource file errors:\n");
      printErrors(result.registryErrors, stderr);
    }
    if (result.weaveErrors.length > 0) {
      stderr.write("\nWeave errors:\n");
      printErrors(result.weaveErrors, stderr);
    }
    if (result.referenceErrors.length > 0) {
      stderr.write("\nReference errors:\n");
      printErrors(result.referenceErrors, stderr);
    }
    return { exitCode: 1 };
  }

  await prepareSiteDir(projectRoot);
  await writeWovenFiles(projectRoot, result.files);
  await writeVitePressConfig(projectRoot, config, {
    linkReferences,
    passageLocationMap: result.passageLocationMap,
  });
  await writeVitePressTheme(projectRoot);

  const siteDir = join(projectRoot, ".site");
  await buildSite(siteDir);

  stdout.write("Site built successfully.\n");
  return {};
}
