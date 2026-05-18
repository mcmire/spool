import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import mdx from "@mdx-js/rollup";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeShiki from "@shikijs/rehype";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteDir = join(__dirname, "..");

export default defineConfig({
  root: siteDir,
  plugins: [
    {
      enforce: "pre",
      ...mdx({
        providerImportSource: "@mdx-js/react",
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeSlug, [rehypeShiki, { theme: "github-dark" }]],
      }),
    },
    react(),
  ],
  build: {
    ssr: "engine/entry-server.jsx",
    outDir: "dist/server",
    rollupOptions: {
      output: {
        entryFileNames: "entry-server.js",
      },
    },
  },
});
