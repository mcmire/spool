/// <reference lib="dom" />
/// <reference types="vite/client" />
import { useEffect, useState } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import type { Root } from "react-dom/client";

import type { NavData } from "./Layout.tsx";
import { NavItems } from "./Layout.tsx";

/**
 * React roots reused across HMR updates so that re-running this module after a
 * Layout.tsx edit re-renders into the SAME root instead of creating a new tree.
 * Mutated in place; the object lives in import.meta.hot.data which Vite hands
 * to the next module instance.
 */
type Persisted = { navRoot?: Root; effectsRoot?: Root };

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
    mermaid.initialize({ startOnLoad: false });
    void mermaid.run();
  }, []);

  return null;
}

/**
 * Bootstraps the client-side React tree: hydrates the server-rendered sidebar
 * and mounts client-only effects. On HMR re-execution, reuses persisted roots
 * so updated components render into the existing DOM without remounting.
 */
function init() {
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
}

init();
