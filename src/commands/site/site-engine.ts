import { copyFile, mkdir, writeFile } from "node:fs/promises";
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

// Resolves to src/commands/site/engine/ (or dist/commands/site/engine/ after build).
const ENGINE_SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "engine");

// The spool package root, used as Vite's root so it resolves React from spool's
// own node_modules regardless of the user project's CWD.
const SPOOL_PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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
): Promise<void> {
  for (const [relPath, content] of files) {
    const currentUrl = relPathToUrl(relPath);
    const navData = buildNavDataForUrl(config, files, currentUrl);
    const pageTitle = extractTitle(content) ?? navData.title;
    const html = await processMarkdown(content, passageLocationMap, relPath);
    const fullHtml = renderLayout(html, pageTitle, navData, currentUrl);
    const dest = urlToDest(destDir, currentUrl);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, fullHtml, "utf-8");
  }
}

export async function startDevServer(
  siteDir: string,
  port: number,
): Promise<{ port: number; stop(): Promise<void>; reload(): void }> {
  const { createServer } = await import("vite");

  const viteServer = await createServer({
    root: siteDir,
    publicDir: ENGINE_SRC_DIR,
    appType: "mpa",
    configFile: false,
    logLevel: "warn",
    server: { port, strictPort: false },
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
