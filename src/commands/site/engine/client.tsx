/// <reference lib="dom" />
/// <reference types="vite/client" />
import { useEffect, useState } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import type { NavData } from "./Layout.tsx";
import { NavItems } from "./Layout.tsx";

/**
 * React roots and event handlers reused across HMR updates so that re-running
 * this module after an edit re-renders into the SAME root and rebinds the SAME
 * handlers without leaking old ones. Mutated in place; the object lives in
 * import.meta.hot.data which Vite hands to the next module instance.
 */
type Persisted = {
  /**
   * Root for the sidebar nav React tree.
   */
  navRoot?: Root;
  /**
   * Root for the effects-only React tree.
   */
  effectsRoot?: Root;
  /**
   * The active document click handler, stored so HMR can remove it before
   * re-registering a fresh one.
   */
  clickHandler?: (e: MouseEvent) => void;
  /**
   * The active popstate handler, stored so HMR can remove it before
   * re-registering a fresh one.
   */
  popStateHandler?: () => void;
};

declare const mermaid: {
  initialize(config: Record<string, unknown>): void;
  run(): Promise<void>;
};

const persisted: Persisted = import.meta.hot?.data ?? {};

if (import.meta.hot) {
  import.meta.hot.accept();
}

/**
 * Handles client-side visual effects: hash-based passage highlighting and Mermaid rendering.
 * This component is client-only and is never server-rendered.
 */
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
    if (!hash) {
      return;
    }
    const el = document.getElementById(hash);
    if (el?.classList.contains("spool-passage")) {
      el.classList.remove("spool-targeted");
      void el.offsetWidth;
      el.classList.add("spool-targeted");
    }
  }, [hash]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function runMermaid() {
      mermaid.initialize({ startOnLoad: false, theme: mediaQuery.matches ? "dark" : "default" });
      void mermaid.run();
    }

    runMermaid();
    mediaQuery.addEventListener("change", runMermaid);
    return () => mediaQuery.removeEventListener("change", runMermaid);
  }, []);

  return null;
}

/**
 * Guards against overlapping navigations. The last click wins once the
 * in-flight fetch settles; this flag is cleared in navigateTo's finally block.
 */
let isNavigating = false;

/**
 * Bootstraps the client-side React tree and wires up client-side navigation.
 * On HMR re-execution, reuses persisted roots and swaps event handlers so
 * updated components render into the existing DOM without remounting.
 */
function init(): void {
  const navEl = document.getElementById("spool-sidebar-nav");
  if (navEl) {
    const navData = JSON.parse(navEl.getAttribute("data-nav") ?? "{}") as NavData;
    const currentUrl = navEl.getAttribute("data-current-url") ?? "/";
    const navContent = <NavItems items={navData.sidebar} currentUrl={currentUrl} />;
    if (persisted.navRoot) {
      persisted.navRoot.render(navContent);
    } else {
      persisted.navRoot = hydrateRoot(navEl, navContent);
    }
  }

  const rootEl = document.getElementById("spool-root");
  if (rootEl) {
    if (!persisted.effectsRoot) {
      persisted.effectsRoot = createRoot(rootEl);
    }
    persisted.effectsRoot.render(<SpoolEffects />);
  }

  if (persisted.clickHandler) {
    document.removeEventListener("click", persisted.clickHandler);
  }
  if (persisted.popStateHandler) {
    window.removeEventListener("popstate", persisted.popStateHandler);
  }

  persisted.clickHandler = handleLinkClick;
  persisted.popStateHandler = handlePopState;
  document.addEventListener("click", persisted.clickHandler);
  window.addEventListener("popstate", persisted.popStateHandler);
}

/**
 * Triggers client-side navigation when the browser fires a popstate event
 * (back/forward button). Does not push a new history entry.
 */
function handlePopState(): void {
  void navigateTo(
    window.location.pathname + window.location.search + window.location.hash,
    false,
  );
}

/**
 * Intercepts clicks on same-origin internal links and performs client-side
 * navigation instead of a full page reload. Falls back to native navigation
 * for external links, hash-only anchors, _blank targets, and modifier-key clicks.
 */
function handleLinkClick(e: MouseEvent): void {
  const anchor = (e.target as Element).closest("a");
  if (!anchor) {
    return;
  }

  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) {
    return;
  }

  if (anchor.target === "_blank") {
    return;
  }

  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
    return;
  }

  const resolvedUrl = new URL(href, window.location.href);
  if (resolvedUrl.origin !== window.location.origin) {
    return;
  }

  e.preventDefault();
  void navigateTo(resolvedUrl.pathname + resolvedUrl.search + resolvedUrl.hash, true);
}

/**
 * Fetches a page by URL, swaps the main content and sidebar nav, and updates
 * the browser history entry. Falls back to a full page load on fetch failure.
 */
async function navigateTo(url: string, updateHistory: boolean): Promise<void> {
  if (isNavigating) {
    return;
  }
  isNavigating = true;

  try {
    const response = await fetch(url, { headers: { Accept: "text/html" } });
    if (!response.ok) {
      window.location.href = url;
      return;
    }

    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const newMain = doc.querySelector("main.spool-content");
    const currentMain = document.querySelector("main.spool-content");
    if (newMain && currentMain) {
      currentMain.innerHTML = newMain.innerHTML;
    }

    document.title = doc.title;

    if (updateHistory) {
      history.pushState(null, "", url);
    }

    const newNavEl = doc.getElementById("spool-sidebar-nav");
    const navEl = document.getElementById("spool-sidebar-nav");
    if (newNavEl && navEl) {
      const newNavDataStr = newNavEl.getAttribute("data-nav") ?? "{}";
      const navData = JSON.parse(newNavDataStr) as NavData;
      const currentUrl = newNavEl.getAttribute("data-current-url") ?? "/";
      navEl.setAttribute("data-nav", newNavDataStr);
      navEl.setAttribute("data-current-url", currentUrl);
      persisted.navRoot?.render(<NavItems items={navData.sidebar} currentUrl={currentUrl} />);
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mermaid.initialize({ startOnLoad: false, theme: mediaQuery.matches ? "dark" : "default" });
    void mermaid.run();

    const targetUrl = new URL(url, window.location.href);
    const hash = targetUrl.hash.slice(1);
    if (hash) {
      const el = document.getElementById(hash);
      if (el) {
        el.scrollIntoView();
        if (el.classList.contains("spool-passage")) {
          el.classList.remove("spool-targeted");
          void el.offsetWidth;
          el.classList.add("spool-targeted");
        }
      }
    } else {
      window.scrollTo(0, 0);
    }
  } catch {
    window.location.href = url;
  } finally {
    isNavigating = false;
  }
}

init();
