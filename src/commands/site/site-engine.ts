import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MERMAID_DIST = createRequire(import.meta.url).resolve("mermaid/dist/mermaid.min.js");

import type { SpoolConfig } from "../../config.ts";
import type { PassageLocationMap } from "./reference-map.ts";
import { processMarkdown } from "./engine/process-markdown.ts";
import { renderLayout } from "./engine/Layout.tsx";
import type { NavItem, NavData } from "./engine/Layout.tsx";

export type { NavData };

/**
 * The spool package root. Vite's root is set here so it resolves React from
 * spool's own node_modules regardless of the user project's CWD.
 */
const SPOOL_PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Absolute path to the engine source directory.
 * When running inside the spool repo (src/ is present), this resolves to
 * src/commands/site/engine/ so edits to engine files are picked up immediately
 * by the dev server without rebuilding. When the package is installed (no src/),
 * it falls back to the compiled dist/commands/site/engine/ copy.
 * Exported so the dev command can watch it for file changes.
 */
export const ENGINE_SRC_DIR = (() => {
  const srcDir = join(SPOOL_PKG_ROOT, "src", "commands", "site", "engine");
  const distDir = join(dirname(fileURLToPath(import.meta.url)), "engine");
  return existsSync(srcDir) ? srcDir : distDir;
})();

/**
 * Pluggable render functions for writeHtmlPages.
 * Used by the dev command to supply hot-reloaded engine modules so page HTML
 * is regenerated with the latest code without restarting the server.
 */
export type PageRenderers = {
  /**
   * Converts markdown content to an HTML string.
   */
  processMarkdown(
    content: string,
    passageLocationMap?: PassageLocationMap,
    fileRelPath?: string,
  ): Promise<string>;
  /**
   * Wraps content HTML in the full page layout and returns the HTML string.
   */
  renderLayout(html: string, pageTitle: string, navData: NavData, currentUrl: string, clientBundleVersion?: string): string;
};

async function buildClientBundle(outputDir: string): Promise<void> {
  const { build } = await import("vite");
  await build({
    root: SPOOL_PKG_ROOT,
    configFile: false,
    logLevel: "silent",
    esbuild: { jsx: "automatic" },
    build: {
      lib: {
        entry: join(ENGINE_SRC_DIR, "client.tsx"),
        formats: ["iife"],
        name: "SpoolClient",
        fileName: () => "spool-client.js",
      },
      outDir: outputDir,
      emptyOutDir: false,
    },
  });
}

export async function prepareSiteDir(projectRoot: string): Promise<void> {
  const siteDir = join(projectRoot, ".site");
  await mkdir(siteDir, { recursive: true });
  await copyFile(MERMAID_DIST, join(siteDir, "spool-mermaid.js"));
  await buildClientBundle(siteDir);
}

function extractTitle(content: string): string | undefined {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function titleCase(str: string): string {
  return str
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function relPathToUrl(relPath: string): string {
  const withoutIndex = relPath.replace(/(^|\/)index\.md$/, "$1");
  const withoutExt = withoutIndex.replace(/\.md$/, "");
  const trimmed = withoutExt.replace(/\/$/, "");
  return trimmed ? "/" + trimmed : "/";
}

function urlToDest(destDir: string, url: string): string {
  if (url === "/") return join(destDir, "index.html");
  const path = url.replace(/^\/|\/$/g, "") + ".html";
  return join(destDir, path);
}

type FileTree = {
  files: Map<string, string>;
  dirs: Map<string, FileTree>;
};

function buildFileTree(files: Map<string, string>): FileTree {
  const tree: FileTree = { files: new Map(), dirs: new Map() };

  for (const [relPath, content] of files) {
    const parts = relPath.split("/");
    let current = tree;

    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i]!;
      if (!current.dirs.has(dirName)) {
        current.dirs.set(dirName, { files: new Map(), dirs: new Map() });
      }
      current = current.dirs.get(dirName)!;
    }

    const fileName = parts[parts.length - 1]!;
    current.files.set(fileName, content);
  }

  return tree;
}

function treeToNavItems(tree: FileTree, currentDirPath: string, currentUrl: string): NavItem[] {
  const items: NavItem[] = [];

  const indexVariants = ["index.md", "readme.md", "README.md"];
  const indexFile = tree.files.keys().find((f) => indexVariants.includes(f));

  const sortedFileNames = [...tree.files.keys()].filter((f) => f !== indexFile).sort();

  if (indexFile) {
    sortedFileNames.unshift(indexFile);
  }

  for (const fileName of sortedFileNames) {
    const content = tree.files.get(fileName)!;
    const relPath = currentDirPath ? currentDirPath + "/" + fileName : fileName;
    const label = extractTitle(content) ?? titleCase(fileName.replace(/\.md$/, ""));
    const url = relPathToUrl(relPath);

    items.push({ text: label, url });
  }

  const sortedDirNames = [...tree.dirs.keys()].sort();

  for (const dirName of sortedDirNames) {
    const subTree = tree.dirs.get(dirName)!;
    const dirUrl = currentDirPath ? currentDirPath + "/" + dirName : dirName;
    const childItems = treeToNavItems(subTree, dirUrl, currentUrl);

    const isExpanded = urlStartsWith(currentUrl, "/" + dirUrl);

    items.push({
      text: titleCase(dirName),
      items: childItems,
      expanded: isExpanded,
    });
  }

  return items;
}

function urlStartsWith(url: string, prefix: string): boolean {
  const normalizedUrl = url.replace(/\/$/, "");
  const normalizedPrefix = prefix.replace(/\/$/, "");
  return normalizedUrl === normalizedPrefix || normalizedUrl.startsWith(normalizedPrefix + "/");
}

function buildNavDataForUrl(
  config: SpoolConfig,
  files: Map<string, string>,
  currentUrl: string,
): NavData {
  const title: string =
    ((config.site as Record<string, unknown> | undefined)?.title as string) ?? "Docs";

  const tree = buildFileTree(files);
  const sidebar: NavItem[] = [];

  const indexVariants = ["index.md", "readme.md", "README.md"];
  const rootIndexFile = tree.files.keys().find((f) => indexVariants.includes(f));

  if (rootIndexFile) {
    sidebar.push({ text: "Home", url: "/" });
    tree.files.delete(rootIndexFile);
  }

  const rootItems = treeToNavItems(tree, "", currentUrl);
  sidebar.push(...rootItems);

  return { title, sidebar };
}

export function buildNavData(
  config: SpoolConfig,
  files: Map<string, string>,
  currentUrl: string,
): NavData {
  return buildNavDataForUrl(config, files, currentUrl);
}

export async function writeHtmlPages(
  destDir: string,
  files: Map<string, string>,
  config: SpoolConfig,
  passageLocationMap?: PassageLocationMap,
  renderers?: PageRenderers,
  clientBundleVersion?: string,
): Promise<void> {
  const md = renderers?.processMarkdown ?? processMarkdown;
  const render = renderers?.renderLayout ?? renderLayout;

  for (const [relPath, content] of files) {
    const currentUrl = relPathToUrl(relPath);
    const navData = buildNavDataForUrl(config, files, currentUrl);
    const pageTitle = extractTitle(content) ?? navData.title;
    const html = await md(content, passageLocationMap, relPath);
    const fullHtml = render(html, pageTitle, navData, currentUrl, clientBundleVersion);
    const dest = urlToDest(destDir, currentUrl);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, fullHtml, "utf-8");
  }
}

/**
 * A running Vite dev server instance returned by startDevServer.
 */
export type DevServer = {
  /**
   * The port the dev server is actually listening on.
   */
  port: number;
  /**
   * Stops the dev server and closes all connections.
   */
  stop(): Promise<void>;
  /**
   * Sends a full page reload signal to all connected browsers.
   */
  reload(): void;
  /**
   * Sends a CSS HMR update so connected browsers re-fetch the stylesheet
   * without a full page reload.
   */
  sendCssHmr(cssPath: string): void;
  /**
   * Loads a module via Vite's SSR transform pipeline, bypassing Node's module
   * cache. Call invalidateModuleGraph first to ensure stale entries are evicted.
   */
  ssrLoadModule(path: string): Promise<Record<string, unknown>>;
  /**
   * Marks all entries in Vite's module graph as stale so the next ssrLoadModule
   * call reloads them from disk.
   */
  invalidateModuleGraph(): void;
};

export async function startDevServer(siteDir: string, port: number): Promise<DevServer> {
  const { createServer } = await import("vite");

  const viteServer = await createServer({
    root: siteDir,
    publicDir: ENGINE_SRC_DIR,
    appType: "mpa",
    configFile: false,
    logLevel: "warn",
    esbuild: { jsx: "automatic" },
    server: {
      port,
      strictPort: false,
      fs: { allow: [SPOOL_PKG_ROOT, siteDir] },
    },
    plugins: [
      {
        name: "spool-md-rewrite",
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url) {
              const match = req.url.match(/^(.+)\.md([?#].*)?$/);
              if (match) {
                req.url = match[1] + ".html" + (match[2] ?? "");
              }
            }
            next();
          });
        },
      },
    ],
  });

  await viteServer.listen();

  const addr = viteServer.httpServer?.address();
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;

  return {
    port: actualPort,
    async stop() {
      await viteServer.close();
    },
    reload() {
      viteServer.ws.send({ type: "full-reload" });
    },
    sendCssHmr(cssPath: string) {
      viteServer.ws.send({
        type: "update",
        updates: [
          {
            type: "css-update",
            path: cssPath,
            acceptedPath: cssPath,
            timestamp: Date.now(),
          },
        ],
      });
    },
    ssrLoadModule(path: string) {
      return viteServer.ssrLoadModule(path) as Promise<Record<string, unknown>>;
    },
    invalidateModuleGraph() {
      viteServer.moduleGraph.invalidateAll();
    },
  };
}

export async function buildSite(
  projectRoot: string,
  files: Map<string, string>,
  config: SpoolConfig,
  passageLocationMap?: PassageLocationMap,
): Promise<void> {
  const distDir = join(projectRoot, ".site", "dist", "static");
  await mkdir(distDir, { recursive: true });

  await writeHtmlPages(distDir, files, config, passageLocationMap);

  await copyFile(join(ENGINE_SRC_DIR, "spool-site.css"), join(distDir, "spool-site.css"));
  await copyFile(MERMAID_DIST, join(distDir, "spool-mermaid.js"));
  await buildClientBundle(distDir);
}
