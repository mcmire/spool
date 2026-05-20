import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { SpoolConfig } from "../../config.ts";
import type { PassageLocationMap } from "./reference-map.ts";
import { processMarkdown } from "./engine/process-markdown.ts";
import { renderLayout } from "./engine/Layout.tsx";
import type { NavData } from "./engine/Layout.tsx";

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
  await buildClientBundle(siteDir);
}

function extractTitle(content: string): string | undefined {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim();
}

function relPathToLabel(relPath: string): string {
  const base = basename(relPath, extname(relPath));
  return base === "index"
    ? "Overview"
    : base
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

export function buildNavData(config: SpoolConfig, files: Map<string, string>): NavData {
  const title: string =
    ((config.site as Record<string, unknown> | undefined)?.title as string) ?? "Docs";

  type NavItem = { text: string; url: string } | { text: string; items: NavItem[] };
  const sidebar: NavItem[] = [];
  const groups = new Map<string, NavItem[]>();

  for (const relPath of [...files.keys()].sort()) {
    const content = files.get(relPath) ?? "";
    const label = extractTitle(content) ?? relPathToLabel(relPath);
    const url = relPathToUrl(relPath);
    const parts = relPath.split("/");

    if (parts.length === 1) {
      sidebar.push({ text: label, url });
    } else {
      const dir = parts[0]!;
      if (!groups.has(dir)) {
        const groupItems: NavItem[] = [];
        groups.set(dir, groupItems);
        sidebar.push({ text: relPathToLabel(dir + ".md"), items: groupItems });
      }
      groups.get(dir)!.push({ text: label, url });
    }
  }

  return { title, sidebar };
}

export async function writeHtmlPages(
  destDir: string,
  files: Map<string, string>,
  navData: NavData,
  passageLocationMap?: PassageLocationMap,
): Promise<void> {
  for (const [relPath, content] of files) {
    const pageTitle = extractTitle(content) ?? navData.title;
    const html = await processMarkdown(content, passageLocationMap, relPath);
    const fullHtml = renderLayout(html, pageTitle, navData);
    const dest = urlToDest(destDir, relPathToUrl(relPath));
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

  const navData = buildNavData(config, files);
  await writeHtmlPages(distDir, files, navData, passageLocationMap);

  await copyFile(join(ENGINE_SRC_DIR, "spool-site.css"), join(distDir, "spool-site.css"));
  await buildClientBundle(distDir);
}
