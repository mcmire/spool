import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

type NavItem = { text: string; url: string } | { text: string; items: NavItem[] };
export type NavData = { title: string; sidebar: NavItem[] };

function NavItems({ items }: { items: NavItem[] }) {
  return (
    <ul>
      {items.map((item, i) =>
        "items" in item ? (
          <li key={i} className="spool-nav-group">
            <span className="spool-nav-group-title">{item.text}</span>
            <NavItems items={item.items} />
          </li>
        ) : (
          <li key={i}>
            <a href={item.url}>{item.text}</a>
          </li>
        ),
      )}
    </ul>
  );
}

function Layout({
  contentHtml,
  pageTitle,
  navData,
}: {
  contentHtml: string;
  pageTitle: string;
  navData: NavData;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{pageTitle}</title>
        <link rel="stylesheet" href="/spool-site.css" />
      </head>
      <body>
        <div className="spool-layout">
          <aside className="spool-sidebar">
            <a href="/" className="spool-site-title">
              {navData.title}
            </a>
            <nav>
              <NavItems items={navData.sidebar} />
            </nav>
          </aside>
          <main className="spool-content" dangerouslySetInnerHTML={{ __html: contentHtml }} />
        </div>
        <div id="spool-root" />
        <script src="/spool-mermaid.js" />
        <script src="/spool-client.js" />
      </body>
    </html>
  );
}

export function renderLayout(contentHtml: string, pageTitle: string, navData: NavData): string {
  return (
    "<!DOCTYPE html>" +
    renderToStaticMarkup(
      <Layout contentHtml={contentHtml} pageTitle={pageTitle} navData={navData} />,
    )
  );
}
