import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

type NavLink = { text: string; url: string };
type NavGroup = { text: string; items: NavItem[]; expanded: boolean };
export type NavItem = NavLink | NavGroup;
export type NavData = { title: string; sidebar: NavItem[] };

function isGroup(item: NavItem): item is NavGroup {
  return "items" in item;
}

function isLink(item: NavItem): item is NavLink {
  return "url" in item;
}

function urlMatchesPath(url: string, currentUrl: string): boolean {
  const normalizedUrl = url.replace(/\/$/, "");
  const normalizedCurrent = currentUrl.replace(/\/$/, "");
  return normalizedUrl === normalizedCurrent;
}

function NavItems({ items, currentUrl }: { items: NavItem[]; currentUrl: string }) {
  return (
    <ul>
      {items.map((item, i) => {
        if (isGroup(item)) {
          return (
            <li key={i} className="spool-nav-group">
              <button
                type="button"
                className="spool-nav-group-toggle"
                data-expanded={item.expanded ? "true" : "false"}
              >
                <span className="spool-nav-group-title">{item.text}</span>
                <span className="spool-nav-chevron" />
              </button>
              {item.expanded ? (
                <ul className="spool-nav-group-children">
                  <NavItems items={item.items} currentUrl={currentUrl} />
                </ul>
              ) : null}
            </li>
          );
        }

        if (isLink(item)) {
          const isActive = urlMatchesPath(item.url, currentUrl);
          return (
            <li key={i}>
              <a href={item.url} className={isActive ? "spool-nav-active" : undefined}>
                {item.text}
              </a>
            </li>
          );
        }

        return null;
      })}
    </ul>
  );
}

function Layout({
  contentHtml,
  pageTitle,
  navData,
  currentUrl,
}: {
  contentHtml: string;
  pageTitle: string;
  navData: NavData;
  currentUrl: string;
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
            <nav
              id="spool-sidebar-nav"
              data-nav={JSON.stringify(navData)}
              data-current-url={currentUrl}
            >
              <NavItems items={navData.sidebar} currentUrl={currentUrl} />
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

export function renderLayout(
  contentHtml: string,
  pageTitle: string,
  navData: NavData,
  currentUrl: string,
): string {
  return (
    "<!DOCTYPE html>" +
    renderToStaticMarkup(
      <Layout
        contentHtml={contentHtml}
        pageTitle={pageTitle}
        navData={navData}
        currentUrl={currentUrl}
      />,
    )
  );
}
