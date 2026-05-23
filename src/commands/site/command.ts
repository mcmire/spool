import { watch } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, loadConfig } from "../../config.ts";
import type { SpoolConfig } from "../../config.ts";
import type { FileErrors } from "../../registries.ts";
import type { PassageLocationMap } from "./reference-map.ts";
import {
  prepareSiteDir,
  writeHtmlPages,
  startDevServer,
  buildSite,
  ENGINE_SRC_DIR,
} from "./site-engine.ts";
import type { DevServer, PageRenderers } from "./site-engine.ts";
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

/**
 * Handles a file change event in the engine source directory.
 * CSS changes trigger a hot CSS update; React/TS changes trigger a fresh SSR
 * re-render and a full page reload.
 */
async function handleEngineChange(
  filename: string,
  server: DevServer,
  siteDir: string,
  latestFiles: Map<string, string>,
  latestPassageMap: PassageLocationMap | undefined,
  config: SpoolConfig,
  projectRoot: string,
  stdout: Writable,
): Promise<void> {
  if (filename.endsWith(".css")) {
    server.sendCssHmr(`/${filename}`);
    return;
  }

  server.invalidateModuleGraph();

  if (filename.endsWith(".tsx") || filename.endsWith(".jsx")) {
    await prepareSiteDir(projectRoot);
  }

  const renderers = await loadEngineRenderers(server);
  await writeHtmlPages(siteDir, latestFiles, config, latestPassageMap, renderers);
  server.reload();
  stdout.write(`Engine updated: re-rendered ${latestFiles.size} page(s).\n`);
}

/**
 * Loads fresh engine renderer functions via Vite's SSR module pipeline so that
 * edits to Layout.tsx or process-markdown.ts take effect without a server restart.
 */
async function loadEngineRenderers(server: DevServer): Promise<PageRenderers> {
  const [pmModule, layoutModule] = await Promise.all([
    server.ssrLoadModule(join(ENGINE_SRC_DIR, "process-markdown.ts")),
    server.ssrLoadModule(join(ENGINE_SRC_DIR, "Layout.tsx")),
  ]);
  return {
    // Type assertion: ssrLoadModule returns Record<string, unknown>; we trust that
    // the engine modules export the correct shapes.
    processMarkdown: pmModule["processMarkdown"] as PageRenderers["processMarkdown"],
    // Type assertion: same reason as above.
    renderLayout: layoutModule["renderLayout"] as PageRenderers["renderLayout"],
  };
}

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

  const siteDir = join(projectRoot, ".site");
  await prepareSiteDir(projectRoot);

  await writeHtmlPages(
    siteDir,
    result.files,
    config,
    linkReferences ? result.passageLocationMap : undefined,
  );

  const startPort = portOption ? parseInt(portOption, 10) : 5173;
  stdout.write("Warming up dev server...\n");
  const warmupStart = Date.now();
  const server = await startDevServer(siteDir, startPort);
  const elapsed = ((Date.now() - warmupStart) / 1000).toFixed(2);

  stdout.write(`Dev server running at http://localhost:${server.port} (ready in ${elapsed}s)\n`);

  const sourceDir = join(projectRoot, config.source.code);
  const docsDir = join(projectRoot, config.source.docs);

  let latestFiles = result.files;
  let latestPassageMap = linkReferences ? result.passageLocationMap : undefined;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleReweave(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(async () => {
      try {
        const r = await weaveSiteFiles(projectRoot, config, weaveOptions);
        latestFiles = r.files;
        latestPassageMap = linkReferences ? r.passageLocationMap : undefined;
        await writeHtmlPages(siteDir, r.files, config, latestPassageMap);
        server.reload();
        stdout.write(`Re-wove: ${r.files.size} file(s) written.\n`);
      } catch (err) {
        stderr.write(`Re-weave failed: ${err}\n`);
      }
    }, 200);
  }

  let engineDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  watch(ENGINE_SRC_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) {
      return;
    }
    if (engineDebounceTimer) {
      clearTimeout(engineDebounceTimer);
    }
    engineDebounceTimer = setTimeout(async () => {
      try {
        await handleEngineChange(
          filename,
          server,
          siteDir,
          latestFiles,
          latestPassageMap,
          config,
          projectRoot,
          stdout,
        );
      } catch (err) {
        stderr.write(`Engine reload failed: ${err}\n`);
      }
    }, 200);
  });

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
  await buildSite(
    projectRoot,
    result.files,
    config,
    linkReferences ? result.passageLocationMap : undefined,
  );

  stdout.write("Site built successfully.\n");
  return {};
}
