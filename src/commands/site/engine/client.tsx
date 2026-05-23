/// <reference lib="dom" />
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { NavItem, NavData } from "./Layout.tsx";

declare const mermaid: {
  initialize(config: Record<string, unknown>): void;
  run(): Promise<void>;
};

function isGroup(item: NavItem): item is NavGroup {
  return "items" in item;
}

function isLink(item: NavItem): item is NavLink {
  return "url" in item;
}

type NavLink = { text: string; url: string };
type NavGroup = { text: string; items: NavItem[]; expanded: boolean };

function urlMatchesPath(url: string, currentUrl: string): boolean {
  const normalizedUrl = url.replace(/\/$/, "");
  const normalizedCurrent = currentUrl.replace(/\/$/, "");
  return normalizedUrl === normalizedCurrent;
}

function ClientNavItems({
  items,
  currentUrl,
  initialExpanded,
}: {
  items: NavItem[];
  currentUrl: string;
  initialExpanded: Map<string, boolean>;
}) {
  return (
    <ul>
      {items.map((item, i) => {
        if (isGroup(item)) {
          return (
            <ClientNavGroup
              key={i}
              item={item}
              currentUrl={currentUrl}
              initialExpanded={initialExpanded}
            />
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

function ClientNavGroup({
  item,
  currentUrl,
  initialExpanded,
}: {
  item: NavGroup;
  currentUrl: string;
  initialExpanded: Map<string, boolean>;
}) {
  const [expanded, setExpanded] = useState(initialExpanded.get(item.text) ?? item.expanded);

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
          <ClientNavItems
            items={item.items}
            currentUrl={currentUrl}
            initialExpanded={initialExpanded}
          />
        </ul>
      ) : null}
    </li>
  );
}

function Sidebar({ navData, currentUrl }: { navData: NavData; currentUrl: string }) {
  const initialExpanded = new Map<string, boolean>();
  function collectExpanded(items: NavItem[]): void {
    for (const item of items) {
      if (isGroup(item)) {
        initialExpanded.set(item.text, item.expanded);
        collectExpanded(item.items);
      }
    }
  }
  collectExpanded(navData.sidebar);

  return (
    <ClientNavItems
      items={navData.sidebar}
      currentUrl={currentUrl}
      initialExpanded={initialExpanded}
    />
  );
}

function SpoolEffects() {
  const [hash, setHash] = useState(window.location.hash.slice(1));

  useEffect(() => {
    function highlight() {
      setHash(window.location.hash.slice(1));
    }
    window.addEventListener("hashchange", highlight);
    return () => window.removeEventListener("hashchange", highlight);
  }, []);

  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el?.classList.contains("spool-passage")) {
      el.classList.remove("spool-targeted");
      void el.offsetWidth;
      el.classList.add("spool-targeted");
    }
  }, [hash]);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false });
    void mermaid.run();
  }, []);

  return null;
}

function init() {
  const navEl = document.getElementById("spool-sidebar-nav");
  if (navEl) {
    const navData = JSON.parse(navEl.getAttribute("data-nav") ?? "{}") as NavData;
    const currentUrl = navEl.getAttribute("data-current-url") ?? "/";
    createRoot(navEl).render(<Sidebar navData={navData} currentUrl={currentUrl} />);
  }

  createRoot(document.getElementById("spool-root")!).render(<SpoolEffects />);
}

init();
