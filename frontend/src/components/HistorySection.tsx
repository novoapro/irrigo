import React from "react";
import type { ConnectedSensor, Heartbeat } from "../types";
import { formatTimestamp } from "../utils/date";
import { getForecastIcon, getRainIndicatorIcon } from "../utils/weather";
import { GuardStatus } from "./status/GuardCard";
import {
  SensorsList,
  StatusChip,
  type StatusTone
} from "./status/SensorWidgets";

interface HistorySectionProps {
  heartbeats: Heartbeat[];
  totalCount: number;
  page: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
  isLoading: boolean;
}

const getRainStatusMeta = (isBypassed: boolean, isRaining: boolean) => ({
  label: isBypassed ? "Ignored" : (isRaining ? "Yes" : "No"),
  tone: isBypassed ? ("warning" as StatusTone) : (isRaining ? ("alert" as StatusTone) : ("calm" as StatusTone))
});

const getSoilStatusMeta = (isBypassed: boolean, isMoist: boolean) => ({
  label: isBypassed ? "Ignored" : (isMoist ? "Saturated" : "Dry"),
  tone: isBypassed ? ("warning" as StatusTone) : (isMoist ? ("alert" as StatusTone) : ("positive" as StatusTone))
});

const renderBaselineValue = (heartbeat: Heartbeat) =>
  heartbeat.device.baselinePsi.toFixed(1);

const renderPsiChipTone = (heartbeat: Heartbeat): StatusTone =>
  heartbeat.sensors.waterPsi >= heartbeat.device.baselinePsi ? "positive" : "alert";

const renderPsiValue = (heartbeat: Heartbeat) =>
  heartbeat.sensors.waterPsi.toFixed(1);

const formatWeatherTemperature = (weather: Heartbeat["weather"]) => {
  if (!weather || weather.temperature === null || weather.temperature === undefined) {
    return "—";
  }
  const unit = weather.temperatureUnit ?? "F";
  return `${weather.temperature.toFixed(0)}°${unit}`;
};

const formatWeatherPrecip = (weather: Heartbeat["weather"]) => {
  if (
    !weather ||
    weather.precipitationProbability === null ||
    weather.precipitationProbability === undefined
  ) {
    return "—";
  }
  return `${Math.round(weather.precipitationProbability)}%`;
};

const HistorySection = ({
  heartbeats,
  totalCount,
  page,
  totalPages,
  hasPreviousPage,
  hasNextPage,
  onPreviousPage,
  onNextPage,
  isLoading
}: HistorySectionProps) => {
  return (
  <section className="history-panel">
    <header className="history-header">
      <h3>Records</h3>
      <span className="history-header-subtitle muted">
        Showing {heartbeats.length} of {totalCount} record
        {totalCount === 1 ? "" : "s"} • Page {page} of {totalPages}
      </span>
    </header>
    {totalCount === 0 ? (
      <p className="muted">No heartbeat data available for this range.</p>
    ) : (
      <div className={`history-content${isLoading ? " history-content--loading" : ""}`}>
        <div className="table-wrapper history-table-wrapper">
          <table className="history-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Guard</th>
                <th>Rain</th>
                <th>Soil</th>
                <th>Baseline</th>
                <th>PSI</th>
                <th>Conditions</th>
              </tr>
            </thead>
            <tbody>
              {heartbeats.map((heartbeat) => {
                const rainBypassed = !heartbeat.device.connectedSensors?.includes("RAIN");
                const soilBypassed = !heartbeat.device.connectedSensors?.includes("SOIL");
                const rainMeta = getRainStatusMeta(rainBypassed, heartbeat.sensors.rain);
                const soilMeta = getSoilStatusMeta(soilBypassed, heartbeat.sensors.soil);

                return (
                  <tr key={heartbeat._id ?? heartbeat.timestamp}>
                    <td>{formatTimestamp(heartbeat.timestamp)}</td>
                    <td>
                      <GuardStatus guard={heartbeat.guard} />
                    </td>
                    <td>
                      <StatusChip tone={rainMeta.tone}>{rainMeta.label}</StatusChip>
                    </td>
                  <td>
                    <StatusChip tone={soilMeta.tone}>{soilMeta.label}</StatusChip>
                  </td>
                  <td>{renderBaselineValue(heartbeat)}</td>
                  <td>
                    <StatusChip tone={renderPsiChipTone(heartbeat)}>
                        {renderPsiValue(heartbeat)}
                      </StatusChip>
                    </td>
                    <td className="weather-cell">
                      <div className="conditions-cell">
                        {heartbeat.weather ? (
                          <div className="weather-inline">
                            <span className="weather-icon">
                              {getForecastIcon(
                                heartbeat.weather.isDaytime,
                                heartbeat.weather.shortForecast,
                                { background: "light" }
                              )}
                            </span>
                            <div className="weather-details">
                              <span className="weather-temp">
                                {formatWeatherTemperature(heartbeat.weather)}
                              </span>
                              <span className="weather-precip">
                                <span className="rain-icon">
                                  {getRainIndicatorIcon("light")}
                                </span>
                                {formatWeatherPrecip(heartbeat.weather)}
                              </span>
                            </div>
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                        <div className="conditions-sensors">
                          <SensorsList
                            connectedSensors={
                              (heartbeat.device.connectedSensors ?? []) as ConnectedSensor[]
                            }
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="history-cards">
          {heartbeats.map((heartbeat) => {
            const rainBypassed = !heartbeat.device.connectedSensors?.includes("RAIN");
            const soilBypassed = !heartbeat.device.connectedSensors?.includes("SOIL");
            const rainMeta = getRainStatusMeta(rainBypassed, heartbeat.sensors.rain);
            const soilMeta = getSoilStatusMeta(soilBypassed, heartbeat.sensors.soil);

            return (
              <article
                key={`card-${heartbeat._id ?? heartbeat.timestamp}`}
                className="history-card"
              >
                <header className="history-card-header">
                  <div>
                    <span className="history-card-label">Timestamp</span>
                    <span className="history-card-timestamp">
                      {formatTimestamp(heartbeat.timestamp)}
                    </span>
                  </div>
                  <GuardStatus guard={heartbeat.guard} />
                </header>
                <dl className="history-card-metrics">
                  <div>
                    <dt>Baseline</dt>
                    <dd>{renderBaselineValue(heartbeat)}</dd>
                  </div>
                  <div>
                    <dt>Water PSI</dt>
                    <dd>
                      <StatusChip tone={renderPsiChipTone(heartbeat)}>
                        {renderPsiValue(heartbeat)}
                      </StatusChip>
                    </dd>
                  </div>
                  <div>
                    <dt>Rain</dt>
                    <dd>
                      <StatusChip tone={rainMeta.tone}>{rainMeta.label}</StatusChip>
                    </dd>
                  </div>
                  <div>
                    <dt>Soil</dt>
                    <dd>
                      <StatusChip tone={soilMeta.tone}>{soilMeta.label}</StatusChip>
                    </dd>
                  </div>

                  <div className="history-weather">
                    <dt>Weather</dt>
                    <dd>
                      {heartbeat.weather ? (
                        <div className="weather-inline">
                          <span className="weather-icon">
                            {getForecastIcon(
                              heartbeat.weather.isDaytime,
                              heartbeat.weather.shortForecast,
                              { background: "light" }
                            )}
                          </span>
                          <div className="weather-details">
                            <span className="weather-temp">
                              {formatWeatherTemperature(heartbeat.weather)}
                            </span>
                            <span className="weather-precip">
                              <span className="rain-icon">
                                {getRainIndicatorIcon("light")}
                              </span>
                              {formatWeatherPrecip(heartbeat.weather)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="muted">No data</span>
                      )}
                    </dd>
                  </div>
                  <div className="history-sensors">
                    <dt>Sensors</dt>
                    <dd>
                      <SensorsList
                        connectedSensors={
                          (heartbeat.device.connectedSensors ?? []) as ConnectedSensor[]
                        }
                      />
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>

        <div className="pagination-controls">
          <button
            type="button"
            className="ghost-button"
            onClick={onPreviousPage}
            disabled={!hasPreviousPage}
          >
            &lt;
          </button>
          <span className="muted pagination-status">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={onNextPage}
            disabled={!hasNextPage}
          >
            &gt;
          </button>
        </div>
      </div>
    )}
  </section>
  );
};

export default HistorySection;
  
