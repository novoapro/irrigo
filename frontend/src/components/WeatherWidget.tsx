import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { WeatherConditionsSnapshot } from "../types";
import { formatHourLabel, formatTimestamp } from "../utils/date";
import { formatWeatherWindow, getForecastIcon, getRainIndicatorIcon } from "../utils/weather";
import React from "react";
import useMediaQuery from "../hooks/useMediaQuery";
import { useChartTheme } from "../hooks/useChartTheme";
import { useThemeContext } from "../ThemeContext";

export interface PrecipitationPoint {
  timestamp: string;
  probability: number;
}

interface WeatherWidgetProps {
  loading: boolean;
  error: string | null;
  currentWeather: WeatherConditionsSnapshot | null;
  fallbackLocation?: string | null;
  fallbackUpdatedAt?: string | null;
  precipitationSeries: PrecipitationPoint[];
}

const WeatherWidget = ({
  loading,
  error,
  currentWeather,
  fallbackLocation,
  fallbackUpdatedAt,
  precipitationSeries
}: WeatherWidgetProps) => {
  const locationName = currentWeather?.locationName ?? fallbackLocation ?? "";
  const updatedAt = currentWeather?.fetchedAt ?? fallbackUpdatedAt ?? null;
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { theme } = useThemeContext();
  const ct = useChartTheme();
  const isLightForecastCard = theme === "light";
  const iconBackground = isLightForecastCard ? "light" : "dark";
  const chartHeight = isMobile ? 220 : "100%";

  return (
    <section className="forecast-section">
      <article className="forecast-card">
        {loading ? (
          <p className="muted">Loading forecast…</p>
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : currentWeather ? (
          <div className="forecast-body">
            <div className="forecast-columns">
              <div className="forecast-current">
                <div className="forecast-condition-primary">
                  <span className="forecast-icon">
                    {getForecastIcon(currentWeather.isDaytime, currentWeather.shortForecast, {
                      background: iconBackground
                    })}
                  </span>
                  <p className="forecast-temp">
                    {currentWeather.temperature !== null && currentWeather.temperature !== undefined
                      ? `${currentWeather.temperature}°${currentWeather.temperatureUnit ?? "F"}`
                      : "—"}
                  </p>
                </div>
                <span className="forecast-precip-value stacked">
                  <span className="rain-icon">
                    {getRainIndicatorIcon(iconBackground)}
                  </span>
                  {currentWeather.precipitationProbability ?? 0}%
                </span>
                <div className="forecast-leading-meta compact">
                  {currentWeather.shortForecast ? (
                    <p className="forecast-summary">{currentWeather.shortForecast}</p>
                  ) : null}
                  {locationName ? (
                    <span className="forecast-location">{locationName}</span>
                  ) : null}
                </div>
                <div className="forecast-updated-row forecast-updated-row--desktop">
                  <span className="forecast-window">
                    {formatWeatherWindow(
                      currentWeather.periodStart,
                      currentWeather.periodEnd
                    )}
                  </span>
                  <span className="forecast-updated-label">
                    Updated{" "}
                    {updatedAt ? formatTimestamp(updatedAt) : "—"}
                  </span>
                </div>
              </div>

              <div className="forecast-chart">
                {precipitationSeries.length > 0 ? (
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <LineChart
                      data={precipitationSeries}
                      margin={{ top: 8, right: 16, left: 8, bottom: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={ct.gridStroke} />
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={formatHourLabel}
                        minTickGap={28}
                        tick={{ fill: ct.axisColor, fontSize: 12 }}
                        label={{
                          value: "Rain forecast",
                          position: "insideBottom",
                          offset: -8,
                          fill: ct.axisColor,
                          fontSize: 12
                        }}
                      />
                      <YAxis
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        width={32}
                        tick={{ fill: ct.axisColor, fontSize: 12 }}
                      />
                      <Tooltip
                        labelFormatter={(value) => formatTimestamp(value as string)}
                        formatter={(value: number) => `${value}%`}
                        contentStyle={{ backgroundColor: ct.surface, borderColor: ct.borderColor, color: ct.text, borderRadius: "var(--radius-md)" }}
                        labelStyle={{ color: ct.text }}
                      />
                      <Line
                        type="monotone"
                        dataKey="probability"
                        stroke={ct.precipLine}
                        strokeWidth={3}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="muted chart-placeholder">
                    No precipitation outlook for this range.
                  </p>
                )}
              </div>
            </div>
            <div className="forecast-updated-row forecast-updated-row--mobile">
              <span className="forecast-window">
                {formatWeatherWindow(
                  currentWeather.periodStart,
                  currentWeather.periodEnd
                )}
              </span>
              <div className="forecast-meta">
                {locationName ? (
                  <span className="forecast-location-small">{locationName}</span>
                ) : null}
              </div>
              <span className="forecast-updated-label">
                Updated{" "}
                {updatedAt ? formatTimestamp(updatedAt) : "—"}
              </span>
            </div>
          </div>
        ) : (
          <p className="muted">Weather data unavailable.</p>
        )}
      </article>
    </section>
  );
};

export default WeatherWidget;
