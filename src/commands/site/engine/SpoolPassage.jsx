import { useEffect, useRef } from "react";

export function SpoolPassage({ anchor, children }) {
  const ref = useRef(null);

  function triggerIfTargeted() {
    if (!anchor || !ref.current) return;
    if (window.location.hash === "#" + anchor) {
      const el = ref.current;
      el.classList.remove("spool-targeted");
      void el.offsetWidth;
      el.classList.add("spool-targeted");
    }
  }

  useEffect(() => {
    triggerIfTargeted();
    window.addEventListener("hashchange", triggerIfTargeted);
    return () => window.removeEventListener("hashchange", triggerIfTargeted);
  }, [anchor]);

  return (
    <div id={anchor} ref={ref} className="spool-passage">
      {children}
    </div>
  );
}
