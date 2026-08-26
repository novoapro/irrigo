import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "irrigo:theme";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === "system" ? getSystemTheme() : pref;
}

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {}
  return "system";
}

/** Reflect the resolved theme onto <html data-theme> — the CSS variables key off it. */
function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme;
}

/**
 * Theme state: a stored `preference` ("light" | "dark" | "system") and the
 * `theme` it currently resolves to. Mirrors `theme` onto `<html data-theme>`,
 * which is where every CSS variable (and `useChartTheme`) reads it from.
 *
 * Note: `index.html` runs a tiny inline script that applies `data-theme` from
 * localStorage *before* React mounts, so there is no flash of the wrong theme.
 * This hook only keeps it in sync afterward.
 */
export function useTheme() {
  // Read localStorage exactly once (lazy initialiser), then derive `theme` from
  // that same preference — avoids two separate localStorage reads on mount.
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference);
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolve(preference));

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    const resolved = resolve(p);
    setTheme(resolved);
    // Apply the DOM change *synchronously* here, not only via the effect below.
    // This is intentional (not redundant): `useChartTheme` reads the resolved
    // CSS variables during render, so `data-theme` must already be updated on
    // the same tick the toggle triggers — otherwise charts would read the old
    // theme's colours for one render.
    applyTheme(resolved);
    try { localStorage.setItem(STORAGE_KEY, p); } catch {}
  }, []);

  // Declarative backstop: keep <html> in sync with `theme` for any path that
  // changes it (e.g. the OS-preference listener below).
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const resolved = resolve("system");
      setTheme(resolved);
      applyTheme(resolved);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [preference]);

  return { theme, preference, setPreference } as const;
}
