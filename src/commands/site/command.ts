import { watch } from "node:fs";
import { join, sep } from "node:path";
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

/**
 * Describes what types of files changed in the engine directory within a single
 * debounce window. Flags are ORed across all watch events so that a directory-
 * level event fired after a .tsx event does not lose knowledge of the .tsx change.
 */
type EngineChangeFlags = {
  /**
   * True if at least one .tsx or .jsx file changed. Signals that the client
   * bundle must be rebuilt via prepareSiteDir.
   */
  hasTsx: boolean;
  /**
   * Basenames of .css files that changed. When this is non-empty and hasTsx is
   * false the server sends a targeted CSS HMR update instead of a full reload.
   */
  cssFiles: string[];
};

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
 * Handles a batch of file change events in the engine source directory.
 * Pure CSS changes trigger targeted HMR; any React/TS change triggers a fresh
 * SSR re-render and full page reload. When the batch includes a .tsx/.jsx change
 * the client bundle is also rebuilt via prepareSiteDir. Returns the (possibly
 * updated) client bundle version for the caller to persist.
 */
async function handleEngineChange(
  flags: EngineChangeFlags,
  server: DevServer,
  siteDir: string,
  latestFiles: Map<string, string>,
  latestPassageMap: PassageLocationMap | undefined,
  config: SpoolConfig,
  projectRoot: string,
  stdout: Writable,
  clientBundleVersion: string,
): Promise<string> {
  if (!flags.hasTsx && flags.cssFiles.length > 0) {
    for (const cssFile of flags.cssFiles) {
      server.sendCssHmr(`/${cssFile}`);
    }
    return clientBundleVersion;
  }

  server.invalidateModuleGraph();

  let nextClientBundleVersion = clientBundleVersion;
  if (flags.hasTsx) {
    await prepareSiteDir(projectRoot);
    nextClientBundleVersion = Date.now().toString();
  }

  const renderers = await loadEngineRenderers(server);
  await writeHtmlPages(siteDir, latestFiles, config, latestPassageMap, renderers, nextClientBundleVersion);
  server.reload();
  stdout.write(`Engine updated: re-rendered ${latestFiles.size} page(s).\n`);
  return nextClientBundleVersion;
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

  let clientBundleVersion = Date.now().toString();

  await writeHtmlPages(
    siteDir,
    result.files,
    config,
    linkReferences ? result.passageLocationMap : undefined,
    undefined,
    clientBundleVersion,
  );

  const startPort = portOption ? parseInt(portOption, 10) : 5173;
  stdout.write("Warming up dev server...\n");
  const warmupStart = Date.now();
  const server = await startDevServer(siteDir, startPort);
  const elapsed = ((Date.now() - warmupStart) / 1000).toFixed(2);

  stdout.write(`Dev server running at http://localhost:${server.port} (ready in ${elapsed}s)\n`);

  const sourceDir = join(projectRoot, config.source.code);
  const docsDir = join(projectRoot, config.source.docs);

  const engineRelInSource = ENGINE_SRC_DIR.startsWith(sourceDir + sep)
    ? ENGINE_SRC_DIR.slice(sourceDir.length + sep.length)
    : null;

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
        await writeHtmlPages(siteDir, r.files, config, latestPassageMap, undefined, clientBundleVersion);
        server.reload();
        stdout.write(`Re-wove: ${r.files.size} file(s) written.\n`);
      } catch (err) {
        stderr.write(`Re-weave failed: ${err}\n`);
      }
    }, 200);
  }

  let engineDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingTsxChange = false;
  let pendingCssFiles: string[] = [];

  watch(ENGINE_SRC_DIR, { recursive: true }, (_event, filename) => {
    if (!filename) {
      return;
    }
    if (filename.endsWith(".tsx") || filename.endsWith(".jsx")) {
      pendingTsxChange = true;
    } else if (filename.endsWith(".css")) {
      pendingCssFiles.push(filename);
    }
    if (engineDebounceTimer) {
      clearTimeout(engineDebounceTimer);
    }
    engineDebounceTimer = setTimeout(async () => {
      const flags: EngineChangeFlags = {
        hasTsx: pendingTsxChange,
        cssFiles: pendingCssFiles,
      };
      pendingTsxChange = false;
      pendingCssFiles = [];
      try {
        clientBundleVersion = await handleEngineChange(
          flags,
          server,
          siteDir,
          latestFiles,
          latestPassageMap,
          config,
          projectRoot,
          stdout,
          clientBundleVersion,
        );
      } catch (err) {
        stderr.write(`Engine reload failed: ${err}\n`);
      }
    }, 200);
  });

  watch(sourceDir, { recursive: true }, (_event, filename) => {
    if (!filename) {
      return;
    }
    if (engineRelInSource !== null && filename.startsWith(engineRelInSource + sep)) {
      return;
    }
    scheduleReweave();
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
