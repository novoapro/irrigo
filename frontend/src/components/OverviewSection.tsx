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
}: OverviewSectionProps) => (
  <section className="charts-grid">
    <article className="chart-card overview-card">
      {loading ? (
        <p className="muted">Calculating statistics…</p>
      ) : error ? (
        <p className="error-text">⚠️ {error}</p>
      ) : cards.length > 0 ? (
        <div className="overview-grid">
          {pressureOverview ? (
            <div className="overview-item">
              <header>
                <h4>Water Pressure</h4>
              </header>
              <div className="pressure-card-body">
                {pressureOverview.total > 0 ? (
                  <div className="chart-with-legend">
                    <div className="overview-chart">
                      <ResponsiveContainer minWidth={165} minHeight={165}>
                        <PieChart>
                          <Tooltip
                            formatter={(value: number, name: string) => [
                              formatDurationLabel(value as number),
                              name
                            ]}
                          />
                          <Pie
                            data={pressureOverview.data}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="60%"
                            outerRadius="80%"
                            paddingAngle={2}
                          >
                            {pressureOverview.data.map((entry) => (
                              <Cell key={`pressure-${entry.key}`} fill={entry.color} />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="overview-legend compact">
                      {pressureOverview.data.map((entry) => {
                        const total = pressureOverview.total || 1;
                        const percentage = Math.round((entry.value / total) * 100);
                        return (
                          <div key={`pressure-legend-${entry.key}`} className="overview-legend-row">
                            <span
                              className="legend-dot"
                              style={{ backgroundColor: entry.color }}
                            />
                            <div className="legend-labels">
                              <span>{entry.name}</span>
                              <span className="legend-meta">
                                {formatDurationLabel(entry.value)} • {percentage}%
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="muted chart-placeholder pressure-placeholder">
                    No pressure breakdown for this range.
                  </p>
                )}
                <div className="chart-wrapper pressure-trend">
                  {trendData.length > 0 ? (
                    <div className="pressure-trend-container">
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={trendData} margin={{ top: 16, right: 10, left: 0, bottom: 16 }}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis
                            dataKey="timestamp"
                            tickFormatter={(value) => format(parseISO(value), "MMM d")}
                            minTickGap={32}
                          />
                          <YAxis
                            domain={["auto", "auto"]}
                            padding={{ top: 20, bottom: 20 }}
                            width={30}
                          />
                          <Tooltip
                            labelFormatter={(value) => formatTimestamp(value as string)}
                          />
                          <Legend />
                          <Line
                            type="monotone"
                            dataKey="psi"
                            stroke="#2c7be5"
                            strokeWidth={2}
                            dot={false}
                          />
                          {latestBaselinePsi !== undefined ? (
                            <ReferenceLine
                              y={latestBaselinePsi}
                              stroke="#047857"
                              strokeWidth={3}
                              strokeDasharray="4 6"
                              isFront
                              ifOverflow="extendDomain"
                              label={{
                                position: "insideTop",
                                value: `Baseline`,
                                fill: "#065f46",
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
                <h4>{card.title}</h4>
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
                    const percentage =
                      card.total > 0
                        ? Math.round((entry.value / card.total) * 100)
                        : 0;
                    const labelValue =
                      card.unit === "duration"
                        ? formatDurationLabel(entry.value)
                        : formatCountLabel(entry.value, card.unitLabel);
                    return (
                      <div key={entry.key} className="overview-legend-row">
                        <span
                          className="legend-dot"
                          style={{ backgroundColor: entry.color }}
                        />
                        <div className="legend-labels">
                          <span>{entry.name}</span>
                          <span className="legend-meta">
                            {labelValue} • {percentage}%
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

export default OverviewSection;
