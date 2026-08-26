/**
 * OverviewSection — the statistics block on the dashboard.
 *
 * Purely presentational: the parent does all the aggregation and hands this
 * component ready-to-render props. It renders, side by side:
 *  - an optional "Water Pressure" trend (a line chart with a dashed baseline
 *    reference line), and
 *  - one donut (Pie) chart per `card`, each with a custom legend showing each
 *    slice's share of the card total.
 *
 * Key props:
 *  - `cards`: the donut definitions (title, unit, total, slices).
 *  - `pressureOverview` / `trendData` / `latestBaselinePsi`: the pressure panel;
 *    when `pressureOverview` is null the whole pressure panel is omitted.
 *  - `loading` / `error`: gate the loading and error states.
 *
 * Notable notes:
 *  - Holds no state — every value is derived from props (e.g. each legend
 *    `percentage` is computed inline from `entry.value / card.total`).
 *  - Theme-aware via `useChartTheme`; `tooltipStyle` is built once per render and
 *    spread into every Recharts `<Tooltip>` so all tooltips look identical.
 */
import React from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { formatDurationLabel, formatCountLabel, formatTimestamp } from "../utils/date";
import { format, parseISO } from "date-fns";
import { useChartTheme } from "../hooks/useChartTheme";

export type OverviewUnit = "duration" | "count";

export interface OverviewSlice {
  key: string;
  name: string;
  value: number;
  color: string;
}

export interface OverviewCardDefinition {
  key: string;
  title: string;
  unit: OverviewUnit;
  unitLabel: string;
  total: number;
  data: OverviewSlice[];
}

export interface TrendPoint {
  timestamp: string;
  psi: number;
}

interface OverviewSectionProps {
  cards: OverviewCardDefinition[];
  pressureOverview: OverviewCardDefinition | null;
  trendData: TrendPoint[];
  latestBaselinePsi?: number;
  subtitle: string;
  loading: boolean;
  error: string | null;
}

const OverviewSection = ({
  cards,
  pressureOverview,
  trendData,
  latestBaselinePsi,
  subtitle,
  loading,
  error
}: OverviewSectionProps) => {
  const ct = useChartTheme(); // theme-aware chart colors
  // Shared Recharts tooltip styling, spread into each <Tooltip> below so they
  // stay visually consistent and there's one place to change them.
  const tooltipStyle = {
    contentStyle: { backgroundColor: ct.surface, borderColor: ct.borderColor, color: ct.text, borderRadius: "var(--radius-md)" },
    labelStyle: { color: ct.text },
    itemStyle: { color: ct.textSecondary },
  };

  return (
    <section className="charts-grid">
      <article className="chart-card overview-card">
        {loading ? (
          <p className="muted">Calculating statistics…</p>
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : cards.length > 0 ? (
          <div className="overview-grid">
            {pressureOverview ? (
              <div className="overview-item water-pressure-overview">
                <header>
                  <h4>Water Pressure</h4>
                </header>
                <div className="pressure-card-body">
                  <div className="chart-wrapper pressure-trend">
                    {trendData.length > 0 ? (
                      <div className="pressure-trend-container">
                        <ResponsiveContainer width="100%" height={250}>
                          <LineChart data={trendData} margin={{ top: 16, right: 10, left: 0, bottom: 16 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={ct.gridStroke} />
                            <XAxis
                              dataKey="timestamp"
                              tickFormatter={(value) => format(parseISO(value), "MMM d")}
                              minTickGap={32}
                              tick={{ fill: ct.axisColor }}
                            />
                            <YAxis
                              domain={["auto", "auto"]}
                              padding={{ top: 20, bottom: 20 }}
                              width={30}
                              tick={{ fill: ct.axisColor }}
                            />
                            <Tooltip
                              labelFormatter={(value) => formatTimestamp(value as string)}
                              {...tooltipStyle}
                            />
                            <Legend />
                            <Line
                              type="monotone"
                              dataKey="psi"
                              stroke={ct.pressureLine}
                              strokeWidth={2}
                              dot={false}
                            />
                            {/* Dashed horizontal line marking the pressure
                                baseline, drawn only when one is known. */}
                            {latestBaselinePsi !== undefined ? (
                              <ReferenceLine
                                y={latestBaselinePsi}
                                stroke={ct.baselineStroke}
                                strokeWidth={3}
                                strokeDasharray="4 6"
                                isFront
                                ifOverflow="extendDomain"
                                label={{
                                  position: "insideTop",
                                  value: `Baseline`,
                                  fill: ct.baselineLabel,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  dy: -6,
                                  offset: 12
                                }}
                              />
                            ) : null}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="muted chart-placeholder">
                        No data in the selected range.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            {cards.map((card) => (
              <div key={card.key} className="overview-item">
                <header>
                  <h4>{card.title} ({card.unit === "count" ? `${card.unitLabel}s` : "time"})</h4>
                </header>
                <div className="chart-with-legend">
                  <div className="overview-chart">
                    <ResponsiveContainer minWidth={165} minHeight={165}>
                      <PieChart>
                        <Tooltip
                          formatter={(value: number, name: string) => [
                            card.unit === "duration"
                              ? formatDurationLabel(value as number)
                              : formatCountLabel(value as number, card.unitLabel),
                            name
                          ]}
                          {...tooltipStyle}
                        />
                        <Pie
                          data={card.data}
                          dataKey="value"
                          nameKey="name"
                          innerRadius="60%"
                          outerRadius="80%"
                          paddingAngle={2}
                        >
                          {card.data.map((entry) => (
                            <Cell
                              key={`${card.key}-${entry.key}`}
                              fill={entry.color}
                            />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="overview-legend compact">
                    {card.data.map((entry) => {
                      // Each slice's share of the card total, derived inline
                      // (guard against divide-by-zero when total is 0).
                      const percentage =
                        card.total > 0
                          ? Math.round((entry.value / card.total) * 100)
                          : 0;
                      return (
                        <div key={entry.key} className="overview-legend-row">
                          <span
                            className="legend-dot"
                            style={{ backgroundColor: entry.color }}
                          />
                          <div className="legend-labels">
                            <span>{entry.name}</span>
                            <span className="legend-meta">
                              ({percentage}%)
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No statistics available for this range.</p>
        )}
      </article>
    </section>
  );
};

export default OverviewSection;
