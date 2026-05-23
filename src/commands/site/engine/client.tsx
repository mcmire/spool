/// <reference lib="dom" />
import { useEffect, useState } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import type { NavData } from "./Layout.tsx";
import { NavItems } from "./Layout.tsx";

declare const mermaid: {
  initialize(config: Record<string, unknown>): void;
  run(): Promise<void>;
};

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
 * and mounts client-only effects.
 */
function init() {
  const navEl = document.getElementById("spool-sidebar-nav");
  if (navEl) {
    const navData = JSON.parse(navEl.getAttribute("data-nav") ?? "{}") as NavData;
    const currentUrl = navEl.getAttribute("data-current-url") ?? "/";
    hydrateRoot(navEl, <NavItems items={navData.sidebar} currentUrl={currentUrl} />);
  }

  createRoot(document.getElementById("spool-root")!).render(<SpoolEffects />);
}

init();
