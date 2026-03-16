import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname, dirname, posix } from "node:path";
import { marked, Renderer } from "marked";
import { findProjectRoot, loadConfig } from "../../config.ts";
import { weaveProject } from "../../weaver.ts";

type Writable = { write(s: string): void };

export type PreviewCommandOptions = {
  cwd: string;
  stdout: Writable;
  port?: string;
};

export type PreviewCommandResult = {
  server: { port: number | undefined; stop(): Promise<void> };
};

function makeRenderer(filePathname: string): Renderer {
  const fileDir = posix.dirname(filePathname);
  const renderer = new Renderer();
  renderer.link = ({ href, title, text }) => {
    if (
      href &&
      !href.startsWith("/") &&
      !href.startsWith("#") &&
      !/^[a-z][a-z+\-.]*:/i.test(href)
    ) {
      href = posix.join(fileDir, href);
    }
    const titleAttr = title ? ` title="${title}"` : "";
    return `<a href="${href}"${titleAttr}>${text}</a>`;
  };
  return renderer;
}

function htmlShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" media="(prefers-color-scheme: light)">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" media="(prefers-color-scheme: dark)">
  <style>
    body { max-width: 800px; margin: 2rem auto; padding: 0 1rem; font-family: system-ui, sans-serif; line-height: 1.6; }
    pre { padding: 1rem; overflow-x: auto; border-radius: 4px; }
    code { font-size: 0.9em; }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #e0e0e0; }
      a { color: #7ab3f5; }
      a:visited { color: #b59af5; }
    }
  </style>
</head>
<body>
${body}
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script>hljs.highlightAll();</script>
</body>
</html>`;
}

async function startOnAvailablePort(
  startPort: number,
  fetch: (req: Request) => Promise<Response>,
): Promise<ReturnType<typeof Bun.serve>> {
  let port = startPort;
  while (true) {
    try {
      return Bun.serve({ port, fetch });
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        port += 1;
        continue;
      }
      throw err;
    }
  }
}

export async function previewCommand({
  cwd,
  stdout,
  port: portOption,
}: PreviewCommandOptions): Promise<PreviewCommandResult> {
  const projectRoot = findProjectRoot(cwd);
  const config = await loadConfig(projectRoot);

  const result = await weaveProject(projectRoot, config);
  stdout.write(`Initial weave: ${result.filesWritten} file(s) written.\n`);

  const targetDir = join(projectRoot, config.target);
  const startPort = portOption ? parseInt(portOption, 10) : 4567;

  const server = await startOnAvailablePort(startPort, async function fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    const filePath = join(targetDir, pathname);

    try {
      if (extname(filePath) === ".md") {
        const content = await readFile(filePath, "utf-8");
        const html = await marked(content, { renderer: makeRenderer(pathname) });
        return new Response(htmlShell(pathname, html), {
          headers: { "Content-Type": "text/html" },
        });
      }

      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }

      // No extension — try resolving as a directory index
      const indexPath = join(filePath, "index.md");
      const indexFile = Bun.file(indexPath);
      if (await indexFile.exists()) {
        const content = await readFile(indexPath, "utf-8");
        const indexPathname = posix.join(pathname === "/" ? "" : pathname, "index.md");
        const html = await marked(content, { renderer: makeRenderer(indexPathname) });
        return new Response(htmlShell(pathname, html), {
          headers: { "Content-Type": "text/html" },
        });
      }

      return new Response("Not found", { status: 404 });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });

  stdout.write(`Preview server running at http://localhost:${server.port}\n`);

  const sourceDir = join(projectRoot, config.source.code);
  const docsDir = join(projectRoot, config.source.docs);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleReweave(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(async () => {
      try {
        const r = await weaveProject(projectRoot, config);
        stdout.write(`Re-wove: ${r.filesWritten} file(s) written.\n`);
      } catch (err) {
        stdout.write(`Re-weave failed: ${err}\n`);
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
