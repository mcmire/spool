/// <reference lib="dom" />
import { useEffect } from "react";
import { createRoot } from "react-dom/client";

declare const mermaid: {
  initialize(config: Record<string, unknown>): void;
  run(): Promise<void>;
};

function SpoolEffects() {
  useEffect(() => {
    function highlight() {
      const hash = window.location.hash.slice(1);
      if (!hash) return;
      const el = document.getElementById(hash);
      if (el?.classList.contains("spool-passage")) {
        el.classList.remove("spool-targeted");
        void el.offsetWidth;
        el.classList.add("spool-targeted");
      }
    }
    highlight();
    window.addEventListener("hashchange", highlight);
    return () => window.removeEventListener("hashchange", highlight);
  }, []);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: false });
    void mermaid.run();
  }, []);

  return null;
}

createRoot(document.getElementById("spool-root")!).render(<SpoolEffects />);
