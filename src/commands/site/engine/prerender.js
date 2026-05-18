import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteDir = join(__dirname, "..");
const serverEntry = join(siteDir, "dist", "server", "entry-server.js");
const staticDir = join(siteDir, "dist", "static");

const { Renderer } = await import(serverEntry);
const renderer = new Renderer();

await mkdir(staticDir, { recursive: true });

for (const [url] of Object.entries(renderer.pages)) {
  const { body } = renderer.render(url);
  let outPath;
  if (url === "/") {
    outPath = join(staticDir, "index.html");
  } else {
    outPath = join(staticDir, url.replace(/^\//, ""), "index.html");
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, body, "utf-8");
}

await copyFile(
  join(__dirname, "spool-site.css"),
  join(staticDir, "spool-site.css"),
);
await copyFile(
  join(__dirname, "spool-highlight.js"),
  join(staticDir, "spool-highlight.js"),
);

console.log(`Prerendered ${Object.keys(renderer.pages).length} page(s).`);
