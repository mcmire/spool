import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { marked } from "marked";
import { findProjectRoot, loadConfig } from "../config.ts";
import { weaveProject } from "../weaver.ts";

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

export async function previewCommand(
  options: { port?: string },
): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const config = await loadConfig(projectRoot);

  // Initial weave
  const result = await weaveProject(projectRoot, config);
  console.log(`Initial weave: ${result.filesWritten} file(s) written.`);

  const targetDir = join(projectRoot, config.targetDocsDir);
  const port = options.port ? parseInt(options.port, 10) : 4567;

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      let pathname = url.pathname === "/" ? "/index.md" : url.pathname;
      const filePath = join(targetDir, pathname);

      try {
        if (extname(filePath) === ".md") {
          const content = await readFile(filePath, "utf-8");
          const html = await marked(content);
          return new Response(htmlShell(pathname, html), {
            headers: { "Content-Type": "text/html" },
          });
        }

        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }

        return new Response("Not found", { status: 404 });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  });

  console.log(`Preview server running at http://localhost:${server.port}`);

  // Watch for changes
  const sourceDir = join(projectRoot, config.sourceCodeDir);
  const docsDir = join(projectRoot, config.sourceDocsDir);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleReweave(): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(async () => {
      try {
        const r = await weaveProject(projectRoot, config);
        console.log(`Re-wove: ${r.filesWritten} file(s) written.`);
      } catch (err) {
        console.error("Re-weave failed:", err);
      }
    }, 200);
  }

  watch(sourceDir, { recursive: true }, (_event, filename) => {
    if (filename) {
      scheduleReweave();
    }
  });

  // Also watch docs dir if it's not inside source dir
  if (!docsDir.startsWith(sourceDir)) {
    watch(docsDir, { recursive: true }, (_event, filename) => {
      if (filename) {
        scheduleReweave();
      }
    });
  }
}
