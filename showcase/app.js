/* ============================================================
   Irrigo Showcase — nav scrollspy, theme toggle, mobile menu
   Vanilla JS, no dependencies. Static-host friendly.
   ============================================================ */
(function () {
  "use strict";

  /* ---------- Theme ---------- */
  var STORAGE_KEY = "irrigo-showcase:theme";
  var root = document.documentElement;
  var toggle = document.getElementById("themeToggle");
  var label = document.getElementById("themeLabel");
  var icon = document.getElementById("themeIcon");

  var SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
  var MOON = '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';

  function applyTheme(theme) {
    root.setAttribute("data-theme", theme);
    var next = theme === "dark" ? "Light" : "Dark";
    if (label) label.textContent = next;
    if (icon) icon.innerHTML = theme === "dark" ? SUN : MOON;
  }

  function initTheme() {
    var stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (!stored) {
      stored = window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    applyTheme(stored);
  }

  if (toggle) {
    toggle.addEventListener("click", function () {
      var current = root.getAttribute("data-theme") === "dark" ? "dark" : "light";
      var next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    });
  }
  initTheme();

  /* ---------- Mobile menu ---------- */
  var sidebar = document.getElementById("sidebar");
  var menuBtn = document.getElementById("menuBtn");
  var scrim = document.getElementById("scrim");

  function closeMenu() {
    if (sidebar) sidebar.classList.remove("is-open");
    if (scrim) scrim.classList.remove("is-open");
  }
  function toggleMenu() {
    if (!sidebar) return;
    var open = sidebar.classList.toggle("is-open");
    if (scrim) scrim.classList.toggle("is-open", open);
  }
  if (menuBtn) menuBtn.addEventListener("click", toggleMenu);
  if (scrim) scrim.addEventListener("click", closeMenu);

  /* ---------- Scrollspy ---------- */
  var links = Array.prototype.slice.call(document.querySelectorAll(".nav__link"));
  var sections = links
    .map(function (l) {
      var id = l.getAttribute("href").slice(1);
      return document.getElementById(id);
    })
    .filter(Boolean);

  var byId = {};
  links.forEach(function (l) { byId[l.getAttribute("href").slice(1)] = l; });

  function setActive(id) {
    links.forEach(function (l) { l.classList.remove("is-active"); });
    if (byId[id]) byId[id].classList.add("is-active");
  }

  // Close the mobile menu when a link is tapped.
  links.forEach(function (l) {
    l.addEventListener("click", function () {
      if (window.innerWidth <= 960) closeMenu();
    });
  });

  var observer;
  if ("IntersectionObserver" in window) {
    var visible = {};
    observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          visible[entry.target.id] = entry.isIntersecting
            ? entry.intersectionRatio
            : 0;
        });
        // Pick the section with the greatest visible ratio.
        var best = null, bestRatio = 0;
        sections.forEach(function (s) {
          var r = visible[s.id] || 0;
          if (r > bestRatio) { bestRatio = r; best = s.id; }
        });
        if (best) setActive(best);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.25, 0.5, 1] }
    );
    sections.forEach(function (s) { observer.observe(s); });
  } else {
    // Fallback: activate on scroll position.
    window.addEventListener("scroll", function () {
      var pos = window.scrollY + 120;
      var current = sections[0] && sections[0].id;
      sections.forEach(function (s) {
        if (s.offsetTop <= pos) current = s.id;
      });
      if (current) setActive(current);
    });
  }

  // Activate whichever section the URL hash points at on load.
  if (location.hash && byId[location.hash.slice(1)]) {
    setActive(location.hash.slice(1));
  } else if (links[0]) {
    links[0].classList.add("is-active");
  }
})();
