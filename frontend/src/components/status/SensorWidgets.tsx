import type { ConnectedSensor } from "../../types";
import type { ReactNode } from "react";
import { formatRelativeTime } from "../../utils/date";
import { getSensorIcon } from "../../utils/sensors";

export type StatusTone =
  | "alert"
  | "calm"
  | "positive"
  | "neutral"
  | "warning"
  | "informative"
  | "negative";

export const StatusChip = ({
  tone = "neutral",
  children
}: {
  tone?: StatusTone;
  children: ReactNode;
}) => (
  <span className={`status-chip status-chip--${tone}`}>{children}</span>
);

export const SensorWidget = ({
  title,
  icon,
  status,
  statusTone = "informative",
  detail,
  active,
  lastChangedAt
}: {
  title: string;
  icon: ReactNode;
  status: string;
  statusTone?: StatusTone;
  detail?: string;
  active: boolean;
  lastChangedAt: string | null;
}) => (
  <article className={`sensor-widget sensor-widget--${statusTone}`}>
    <header className="sensor-widget-header">
      <h3>{title}</h3>
      <span className={`badge ${active ? "badge-on" : "badge-off"}`}>
        {active ? "Active" : "Bypassed"}
      </span>
    </header>
    <div className="sensor-widget-body">
      <span className="sensor-value">{status}</span>
      {detail ? <span className="sensor-detail">{detail}</span> : null}
    </div>
    <footer className="sensor-footer">
      <div className="sensor-icon-anchor" aria-hidden="true">
        {icon}
      </div>
      <div className="sensor-last-update">
        <span className="metric-title">Last Update</span>
        <span className="metric-subtitle">{formatRelativeTime(lastChangedAt)}</span>
      </div>
    </footer>
  </article>
);

export const SensorsList = ({
  connectedSensors
}: {
  connectedSensors: ConnectedSensor[];
}) =>
  connectedSensors.length === 0 ? (
    <span className="muted">—</span>
  ) : (
    <div className="sensor-icons" aria-label="Connected sensors">
      {allSensors.map((sensor) => (
        <span key={sensor} className={`sensor-icon-symbol ${connectedSensors.includes(sensor)? "" : " disabled"}`}>
          {sensorIconMap[sensor]()}
        </span>
      ))}
    </div>
  );

const allSensors: ConnectedSensor[] = ["PRESSURE", "RAIN", "SOIL"]

const sensorIconMap: Record<ConnectedSensor, () => ReactNode> = {
  PRESSURE: () => getSensorIcon("pressure", "sensor-icon--pressure"),
  RAIN: () => getSensorIcon("rain", "sensor-icon--rain"),
  SOIL: () => getSensorIcon("soil", "sensor-icon--soil")
};
