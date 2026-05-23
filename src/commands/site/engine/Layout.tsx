import React, { useState } from "react";
import { renderToString } from "react-dom/server";

/**
 * A link item in the sidebar navigation.
 */
type NavLink = { text: string; url: string };

/**
 * A collapsible group item in the sidebar navigation.
 */
type NavGroupItem = { text: string; items: NavItem[]; expanded: boolean };

/**
 * A single item in the sidebar navigation — either a link or a nested group.
 */
export type NavItem = NavLink | NavGroupItem;

/**
 * Navigation structure and site title used to render the sidebar and page title.
 */
export type NavData = { title: string; sidebar: NavItem[] };

/**
 * Returns true if the given nav item is a collapsible group.
 */
function isGroup(item: NavItem): item is NavGroupItem {
  return "items" in item;
}

/**
 * Returns true if the given nav item is a link.
 */
function isLink(item: NavItem): item is NavLink {
  return "url" in item;
}

/**
 * Returns true if the given nav link URL matches the current page URL.
 */
function urlMatchesPath(url: string, currentUrl: string): boolean {
  const normalizedUrl = url.replace(/\/$/, "");
  const normalizedCurrent = currentUrl.replace(/\/$/, "");
  return normalizedUrl === normalizedCurrent;
}

/**
 * A collapsible sidebar group with a toggle button and optional child items.
 * Used on both server (via renderToString) and client (via hydrateRoot).
 */
function NavGroup({ item, currentUrl }: { item: NavGroupItem; currentUrl: string }) {
  const [expanded, setExpanded] = useState(item.expanded);

  return (
    <li className="spool-nav-group">
      <button
        type="button"
        className="spool-nav-group-toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="spool-nav-group-title">{item.text}</span>
        <span className="spool-nav-chevron" />
      </button>
      {expanded ? (
        <ul className="spool-nav-group-children">
          <NavItems items={item.items} currentUrl={currentUrl} />
        </ul>
      ) : null}
    </li>
  );
}

/**
 * A list of sidebar navigation items, rendered identically on server and client.
 * Exported so the client hydration entry point can reuse the same component tree.
 */
export function NavItems({ items, currentUrl }: { items: NavItem[]; currentUrl: string }) {
  return (
    <ul>
      {items.map((item, i) => {
        if (isGroup(item)) {
          return <NavGroup key={i} item={item} currentUrl={currentUrl} />;
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

/**
 * The full page layout, including the sidebar and main content area.
 */
function Layout({
  contentHtml,
  pageTitle,
  navData,
  currentUrl,
  devClientSrc,
}: {
  contentHtml: string;
  pageTitle: string;
  navData: NavData;
  currentUrl: string;
  /**
   * When set, the page loads the client entry as a module script from this URL
   * instead of the pre-built /spool-client.js bundle. Used by the dev server so
   * Vite owns the module pipeline and can do HMR on client.tsx and its imports.
   */
  devClientSrc?: string;
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
        {devClientSrc ? (
          <script type="module" src={devClientSrc} />
        ) : (
          <script src="/spool-client.js" />
        )}
      </body>
    </html>
  );
}

/**
 * Renders the full page HTML string for a given content block and navigation state.
 * Uses renderToString so the sidebar can be hydrated client-side without a mismatch.
 */
export function renderLayout(
  contentHtml: string,
  pageTitle: string,
  navData: NavData,
  currentUrl: string,
  devClientSrc?: string,
): string {
  return (
    "<!DOCTYPE html>" +
    renderToString(
      <Layout
        contentHtml={contentHtml}
        pageTitle={pageTitle}
        navData={navData}
        currentUrl={currentUrl}
        devClientSrc={devClientSrc}
      />,
    )
  );
}
