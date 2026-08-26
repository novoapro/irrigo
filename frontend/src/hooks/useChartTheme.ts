import { useMemo } from "react";
import { useThemeContext } from "../ThemeContext";

/**
 * Reads the chart colour palette from the CSS custom properties on <html> so
 * charts (Recharts) match the active light/dark theme.
 *
 * Why the `getComputedStyle` read inside a memo is safe here: `data-theme` is
 * always applied to <html> *before* this memo runs — by the inline script in
 * index.html on first paint, and synchronously by `useTheme.setPreference` on
 * toggle (see the note there). So although the read looks impure, it always
 * observes the correct theme, and the memo re-runs whenever `theme` changes.
 */
export function useChartTheme() {
  const { theme } = useThemeContext();

  return useMemo(() => {
    const styles = getComputedStyle(document.documentElement);
    const get = (prop: string) => styles.getPropertyValue(prop).trim();

    return {
      pressureLine: get("--chart-pressure-line"),
      baselineStroke: get("--chart-baseline-stroke"),
      baselineLabel: get("--chart-baseline-label"),
      gridStroke: get("--chart-grid-stroke"),
      axisColor: get("--chart-axis-color"),
      precipLine: get("--chart-precip-line"),
      danger: get("--chart-danger"),
      success: get("--chart-success"),
      info: get("--chart-info"),
      muted: get("--chart-muted"),
      green: get("--chart-green"),
      amber: get("--chart-amber"),
      indigo: get("--chart-indigo"),
      indigoLight: get("--chart-indigo-light"),
      text: get("--color-text"),
      textSecondary: get("--color-text-secondary"),
      surface: get("--color-surface"),
      borderColor: get("--border-color-strong"),
    };
    // `theme` is not referenced in the body but is the required signal: the
    // values above are read from CSS custom properties on <html>, which change
    // when the theme toggles. Recompute whenever `theme` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
}
