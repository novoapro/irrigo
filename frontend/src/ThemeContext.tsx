/**
 * ThemeContext.tsx — the app's theme "broadcast channel."
 *
 * Role in the app: exposes the current theme (light/dark) and the user's
 * preference to any component in the tree without prop-drilling.
 *
 * Concept demonstrated — the React Context provider pattern, in three parts:
 *   1. `createContext(defaultValue)` creates the channel.
 *   2. A `<Provider>` component computes the live value and publishes it.
 *   3. A `useXContext()` hook reads the nearest provider's value.
 * This is the canonical way to share app-wide state (theme, auth, locale)
 * with many distant consumers.
 */
import React, { createContext, useContext } from "react";
import { useTheme, type ThemePreference, type ResolvedTheme } from "./hooks/useTheme";

/** The shape of the value carried on the context channel: the resolved theme
 * actually applied, the user's raw preference, and a setter to change it. */
interface ThemeContextValue {
  theme: ResolvedTheme;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

// The default value is used only when a component calls `useThemeContext()`
// without a `<ThemeProvider>` above it in the tree. Providing a real, safe
// default (rather than `null`) means consumers never have to null-check — a
// common Context ergonomics trick. The no-op `setPreference` keeps calls safe.
const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  preference: "system",
  setPreference: () => {},
});

/**
 * Wraps a subtree and publishes the live theme value to it.
 *
 * `useTheme()` owns the actual logic (reading system preference, persisting the
 * choice, resolving "system" to light/dark); this provider just pipes that
 * value onto the context so descendants can read it via `useThemeContext()`.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const value = useTheme();
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Consumer hook — the only thing components need to import to read theme state.
 * Thin wrapper over `useContext` so callers don't import the context object
 * directly (keeps the context private to this module).
 */
export function useThemeContext() {
  return useContext(ThemeContext);
}
