import { useMemo } from "react";
import { useThemeContext } from "../ThemeContext";

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
  }, [theme]);
}
