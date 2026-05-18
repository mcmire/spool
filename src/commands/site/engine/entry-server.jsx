import { renderToStaticMarkup } from "react-dom/server";
import { MDXProvider } from "@mdx-js/react";
import { SpoolPassage } from "./SpoolPassage.jsx";
import { Layout } from "./Layout.jsx";

const pageModules = import.meta.glob("../pages/**/*.mdx", { eager: true });

function filePathToUrl(filePath) {
  return (
    filePath
      .replace(/^\.\.\/pages/, "")
      .replace(/\/index\.mdx$/, "/")
      .replace(/\.mdx$/, "") || "/"
  );
}

const pages = {};
for (const [path, mod] of Object.entries(pageModules)) {
  pages[filePathToUrl(path)] = mod;
}

const mdxComponents = { SpoolPassage };

export class Renderer {
  get pages() {
    return pages;
  }

  render(pathname) {
    const url = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
    const page = pages[url];
    if (!page) {
      return {
        status: 404,
        body: "<!DOCTYPE html><html><body><h1>Not Found</h1></body></html>",
      };
    }
    const { default: Content, meta } = page;
    const html = renderToStaticMarkup(
      <MDXProvider components={mdxComponents}>
        <Layout meta={meta}>
          <Content />
        </Layout>
      </MDXProvider>,
    );
    return { status: 200, body: "<!DOCTYPE html>" + html };
  }
}
