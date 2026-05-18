import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SpoolConfig } from "../../config.ts";
import type { PassageLocationMap } from "./reference-map.ts";

// Resolves to src/commands/site/ (or dist/commands/site/ after build).
// The engine/ subdirectory sits alongside this file.
const ENGINE_SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "engine");

// Spool's own node_modules directory for the node_modules symlink.
// Path from source: src/commands/site/site-engine.ts → 4 dirname calls → spool/
// Path from dist:   dist/commands/site/site-engine.js → 4 dirname calls → spool/
const SPOOL_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const SPOOL_NODE_MODULES = join(SPOOL_ROOT, "node_modules");

export async function prepareSiteDir(projectRoot: string): Promise<void> {
  const siteDir = join(projectRoot, ".site");
  await mkdir(siteDir, { recursive: true });

  const target = join(siteDir, "node_modules");
  try {
    await lstat(target);
  } catch {
    await symlink(SPOOL_NODE_MODULES, target, "junction");
  }
}

export async function writeWovenFiles(
  projectRoot: string,
  files: Map<string, string>,
): Promise<void> {
  const destDir = join(projectRoot, ".site", "pages");

  for (const [relPath, content] of files) {
    const dest = join(destDir, relPath);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf-8");
  }
}

export async function writeEngineFiles(projectRoot: string): Promise<void> {
  const destDir = join(projectRoot, ".site", "engine");
  await mkdir(destDir, { recursive: true });

  const entries = await readdir(ENGINE_SRC_DIR);
  for (const entry of entries) {
    const src = join(ENGINE_SRC_DIR, entry);
    const dest = join(destDir, entry);
    // Skip nav-data.js and spool-link-plugin.js — those are generated separately.
    if (entry === "nav-data.js" || entry === "spool-link-plugin.js") continue;
    await copyFile(src, dest);
  }
}

type NavItem =
  | { text: string; url: string }
  | { text: string; items: NavItem[] };

function extractTitle(content: string): string | undefined {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

function relPathToLabel(relPath: string): string {
  const base = basename(relPath, extname(relPath));
  return base === "index"
    ? "Overview"
    : base.replace(/^\d+-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function relPathToUrl(relPath: string): string {
  return (
    "/" +
    relPath
      .replace(/\/index\.mdx$/, "/")
      .replace(/\.mdx$/, "")
  );
}

export async function writeNavData(
  projectRoot: string,
  config: SpoolConfig,
  files: Map<string, string>,
): Promise<void> {
  const title: string =
    (config.site as Record<string, unknown> | undefined)?.title as string ??
    "Docs";

  const sidebar: NavItem[] = [];
  const groups = new Map<string, NavItem[]>();

  const sorted = [...files.keys()].sort();

  for (const relPath of sorted) {
    const content = files.get(relPath) ?? "";
    const label = extractTitle(content) ?? relPathToLabel(relPath);
    const url = relPathToUrl(relPath);
    const parts = relPath.split("/");

    if (parts.length === 1) {
      sidebar.push({ text: label, url });
    } else {
      const dir = parts[0]!;
      if (!groups.has(dir)) {
        const groupLabel = relPathToLabel(dir + ".mdx");
        const groupItems: NavItem[] = [];
        groups.set(dir, groupItems);
        sidebar.push({ text: groupLabel, items: groupItems });
      }
      groups.get(dir)!.push({ text: label, url });
    }
  }

  const navData = { title, sidebar };
  const content = `export default ${JSON.stringify(navData, null, 2)};\n`;
  const dest = join(projectRoot, ".site", "engine", "nav-data.js");
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, content, "utf-8");
}

export type SiteEngineOptions = {
  linkReferences?: boolean;
  passageLocationMap?: PassageLocationMap;
};

export async function writeLinkPlugin(
  projectRoot: string,
  options: SiteEngineOptions = {},
): Promise<void> {
  const dest = join(projectRoot, ".site", "engine", "spool-link-plugin.js");
  await mkdir(dirname(dest), { recursive: true });

  if (!options.linkReferences || !options.passageLocationMap) {
    await writeFile(dest, "export function spoolLinkPlugin() { return () => {}; }\n", "utf-8");
    return;
  }

  const mapObj: Record<string, { url: string }> = {};
  for (const [key, info] of options.passageLocationMap) {
    mapObj[key] = { url: info.url };
  }

  const lines: string[] = [
    `const passageMap = ${JSON.stringify(mapObj, null, 2)};`,
    "",
    "import { visit } from 'unist-util-visit';",
    "",
    "export function spoolLinkPlugin() {",
    "  return (tree) => {",
    "    visit(tree, 'text', (node, index, parent) => {",
    // ::SPOOL:: ignore-next
    "      const re = /::SPOOL:: <<(.+?)(?:#([\\w-]+))?>>/ ;",
    "      const m = re.exec(node.value);",
    "      if (!m || !parent || index == null) return;",
    "      const [, file, passage] = m;",
    "      const key = passage ? file + ':' + passage : file + ':';",
    "      const info = passageMap[key];",
    "      if (!info) return;",
    "      const label = passage ? file + '#' + passage : file;",
    "      parent.children.splice(index, 1, {",
    "        type: 'mdxJsxFlowElement',",
    "        name: 'a',",
    "        attributes: [{ type: 'mdxJsxAttribute', name: 'href', value: info.url }, { type: 'mdxJsxAttribute', name: 'className', value: 'spool-ref' }],",
    "        children: [{ type: 'text', value: label }],",
    "      });",
    "    });",
    "  };",
    "}",
    "",
  ];

  await writeFile(dest, lines.join("\n"), "utf-8");
}

export async function startDevServer(
  siteDir: string,
  port: number,
): Promise<{ port: number; stop(): Promise<void> }> {
  const { createServer: createViteServer } = await import("vite");

  const viteServer = await createViteServer({
    configFile: join(siteDir, "engine", "vite.config.js"),
    server: { middlewareMode: true },
    appType: "custom",
  });

  const server = createHttpServer(async (req, res) => {
    viteServer.middlewares(req, res, async () => {
      try {
        const pathname = new URL(req.url ?? "/", "http://x").pathname;
        const { Renderer } = (await viteServer.ssrLoadModule(
          "/engine/entry-server.jsx",
        )) as { Renderer: new () => { render(p: string): { status: number; body: string } } };
        const renderer = new Renderer();
        const { status, body } = renderer.render(pathname);
        res.statusCode = status;
        res.setHeader("Content-Type", "text/html");
        res.end(body);
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  await viteServer.ssrLoadModule("/engine/entry-server.jsx");

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;

  return {
    port: actualPort,
    async stop() {
      await viteServer.close();
      server.close();
    },
  };
}

export async function buildSite(siteDir: string): Promise<void> {
  const { build } = await import("vite");

  await build({
    configFile: join(siteDir, "engine", "vite.config.server.js"),
  });

  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  await execFileAsync("node", [join(siteDir, "engine", "prerender.js")]);
}
