document.addEventListener("DOMContentLoaded", function () {
  function highlight() {
    var hash = window.location.hash.slice(1);
    if (!hash) return;
    var el = document.getElementById(hash);
    if (el && el.classList.contains("spool-passage")) {
      el.classList.remove("spool-targeted");
      void el.offsetWidth;
      el.classList.add("spool-targeted");
    }
  }
  highlight();
  window.addEventListener("hashchange", highlight);
});
