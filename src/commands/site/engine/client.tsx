/// <reference lib="dom" />
import { useEffect } from "react";
import { createRoot } from "react-dom/client";

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

  return null;
}

createRoot(document.getElementById("spool-root")!).render(<SpoolEffects />);
