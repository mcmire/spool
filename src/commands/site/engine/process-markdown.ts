import { posix } from "node:path";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSlug from "rehype-slug";
import rehypeShiki from "@shikijs/rehype";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import type { PassageLocationMap } from "../reference-map.ts";

// Converts ```mermaid code blocks into <pre class="mermaid"> before Shiki runs,
// so Mermaid.js can render them client-side.
function mermaidPlugin() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "element", (node: any, index: any, parent: any) => {
      if (node.tagName !== "pre" || !Array.isArray(node.children)) return;
      const code = node.children.find((c: any) => c.tagName === "code");
      if (!code) return;
      const classes: string[] = code.properties?.className ?? [];
      if (!classes.includes("language-mermaid")) return;
      if (!parent || index == null) return;
      const text = (code.children as any[])
        .filter((c) => c.type === "text")
        .map((c) => c.value)
        .join("");
      parent.children[index] = {
        type: "element",
        tagName: "pre",
        properties: { className: ["mermaid"] },
        children: [{ type: "text", value: text }],
      };
    });
  };
}

// Wraps <pre> elements whose <code> child carries a spool-anchor meta attribute
// in a <div class="spool-passage" id="..."> for hash-based highlighting.
function spoolPassageWrapper() {
  return (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "element", (node: any, index: any, parent: any) => {
      if (node.tagName !== "pre" || !Array.isArray(node.children)) return;
      const code = node.children.find((c: any) => c.tagName === "code");
      if (!code) return;
      const meta = code.data?.meta as string | undefined;
      if (!meta) return;
      const m = /spool-anchor="([^"]+)"/.exec(meta);
      if (!m || !parent || index == null) return;
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { id: m[1], className: ["spool-passage"] },
        children: [node],
      };
    });
  };
}

// Resolves relative .md links to absolute URL paths based on the file's own path,
// so that links work regardless of whether the page URL has a trailing slash.
function resolveRelativeLinks(fileRelPath: string) {
  const dir = posix.dirname(fileRelPath); // e.g. "source" for "source/index.md"
  return () => (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "link", (node: any) => {
      const url = node.url as string;
      if (!url || /^(https?:|mailto:|#|\/)/.test(url)) return;
      const [path, fragment] = url.split("#") as [string, string | undefined];
      const resolved = posix.join(dir, path).replace(/\.md$/, "");
      node.url = fragment ? "/" + resolved + "#" + fragment : "/" + resolved;
    });
  };
}

// Transforms ::SPOOL:: <<file#passage>> text nodes into links using the passage location map.
function spoolLinkPlugin(map: PassageLocationMap) {
  return () => (tree: Parameters<typeof visit>[0]) => {
    visit(tree, "text", (node: any, index: any, parent: any) => {
      // ::SPOOL:: ignore-next
      const m = /::SPOOL:: <<(.+?)(?:#([\w-]+))?>>/.exec(node.value);
      if (!m || !parent || index == null) return;
      const key = m[2] ? `${m[1]}:${m[2]}` : `${m[1]}:`;
      const info = map.get(key);
      if (!info) return;
      const label = m[2] ? `${m[1]}#${m[2]}` : m[1];
      parent.children.splice(index, 1, {
        type: "link",
        url: info.url,
        children: [{ type: "text", value: label }],
      });
    });
  };
}

export async function processMarkdown(
  content: string,
  passageLocationMap?: PassageLocationMap,
  fileRelPath?: string,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = unified() as any;
  p.use(remarkParse).use(remarkGfm);

  if (fileRelPath) {
    p.use(resolveRelativeLinks(fileRelPath));
  }

  if (passageLocationMap) {
    p.use(spoolLinkPlugin(passageLocationMap));
  }

  p.use(remarkRehype, { allowDangerousHtml: true })
    .use(mermaidPlugin)
    .use(spoolPassageWrapper)
    .use(rehypeShiki, { themes: { light: "github-light", dark: "github-dark" } })
    .use(rehypeSlug)
    .use(rehypeStringify);

  return String(await p.process(content));
}
