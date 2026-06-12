import type { ReactNode } from "react";
import type { Zone } from "../../types";
import type { RainPauseStatus } from "../../api";
import type { StatusTone } from "./SensorWidgets";
import { formatElapsedDuration, formatRelativeTime } from "../../utils/date";
import { getSensorIcon } from "../../utils/sensors";
import SystemStatusIcon from "../SystemStatusIcon";

type IrrigationStatus = {
  zone: string | null;
  action: "on" | "off" | null;
};

interface StatusPanelProps {
  guard: boolean;
  irrigation: IrrigationStatus | null;
  lastIrrigationChange: string | null;
  pressureStatus: string;
  pressureTone: StatusTone;
  pressureDetail?: string;
  pressureActive: boolean;
  rainStatus: string;
  rainTone: StatusTone;
  rainActive: boolean;
  soilStatus: string;
  soilTone: StatusTone;
  soilActive: boolean;
  zones?: Zone[];
  rainPause?: RainPauseStatus;
}

const toneColorClass = (tone: StatusTone) => `status-tile--${tone}`;

const StatusTile = ({
  label,
  value,
  tone = "informative",
  detail,
  icon,
  active
}: {
  label: string;
  value: string;
  tone?: StatusTone;
  detail?: string;
  icon?: ReactNode;
  active?: boolean;
}) => (
  <div className={`status-tile ${toneColorClass(tone)}`}>
    <div className="status-tile__header">
      {icon ? <span className="status-tile__icon">{icon}</span> : null}
      <span className="status-tile__label">{label}</span>
      {active !== undefined ? (
        <span className={`status-tile__badge ${active ? "status-tile__badge--on" : "status-tile__badge--off"}`}>
          {active ? "Active" : "Off"}
        </span>
      ) : null}
    </div>
    <span className="status-tile__value">{value}</span>
    {detail ? <span className="status-tile__detail">{detail}</span> : null}
  </div>
);

export const StatusPanel = ({
  guard,
  irrigation,
  lastIrrigationChange,
  pressureStatus,
  pressureTone,
  pressureDetail,
  pressureActive,
  rainStatus,
  rainTone,
  rainActive,
  soilStatus,
  soilTone,
  soilActive,
  zones,
  rainPause
}: StatusPanelProps) => {
  const isIrrigating = irrigation?.action === "on";

  const resolveZoneName = (zoneId: string | null | undefined): string => {
    if (!zoneId) return "";
    const match = zones?.find((z) => z.zoneId === zoneId);
    return match?.name ?? zoneId;
  };

  const zoneName = resolveZoneName(irrigation?.zone);

  const isPaused = !isIrrigating && !guard && rainPause?.active;
  const pauseHoursLeft = isPaused ? Math.ceil(rainPause!.remainingHours ?? 0) : 0;

  const systemState = isIrrigating
    ? `Irrigating ${zoneName}`
    : guard
      ? "Holding irrigation"
      : isPaused
        ? `Irrigation paused · ${pauseHoursLeft}h left`
        : "Ready to irrigate";

  const statusIconType = isIrrigating
    ? "sprinkler" as const
    : guard
      ? "guard-on" as const
      : isPaused
        ? "rain-pause" as const
        : "guard-bypassed" as const;

  const panelTone = isIrrigating
    ? "status-panel--irrigating"
    : guard
      ? "status-panel--holding"
      : isPaused
        ? "status-panel--paused"
        : "status-panel--ready";

  const irrigationValue = isIrrigating
    ? `${zoneName || "—"} ON`
    : "Idle";

  const irrigationDetail = lastIrrigationChange
    ? (isIrrigating ? `Running for ${formatElapsedDuration(lastIrrigationChange)}` : formatRelativeTime(lastIrrigationChange))
    : "No activity";

  return (
    <section className={`status-panel ${panelTone}`}>
      <header className="status-panel__header">
        <div className="status-panel__header-left">
          <div className="status-panel__icon">
            <SystemStatusIcon type={statusIconType} />
          </div>
          <div className="status-panel__title-group">
            <h3 className="status-panel__title">{systemState}</h3>
            <div className="status-panel__chips">
              <span className={`status-chip ${guard ? "status-chip--alert" : "status-chip--positive"}`}>
                {guard ? "Guard on" : "Guard off"}
              </span>
              {isIrrigating ? (
                <span className="status-chip status-chip--alert">Sprinklers ON</span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="status-panel__grid">
        <StatusTile
          label="Irrigation"
          value={irrigationValue}
          tone={isIrrigating ? "alert" : "neutral"}
          detail={irrigationDetail}
        />
        <StatusTile
          label="Pressure"
          icon={getSensorIcon("pressure", "sensor-icon--pressure")}
          value={pressureStatus}
          tone={pressureTone}
          detail={pressureDetail}
          active={pressureActive}
        />
        <div className={`status-tile ${toneColorClass(rainPause?.active ? "negative" : rainTone)}`}>
          <div className="status-tile__header">
            <span className="status-tile__icon">{getSensorIcon("rain", "sensor-icon--rain")}</span>
            <span className="status-tile__label">Rain</span>
            {rainActive ? (
              <span className="status-tile__badge status-tile__badge--on">Active</span>
            ) : (
              <span className="status-tile__badge status-tile__badge--off">Off</span>
            )}
          </div>
          <span className="status-tile__value">{rainPause?.active ? "Detected" : rainStatus}</span>
          {rainPause?.active && (
            <span className="status-tile__detail status-tile__source">
              {rainPause.source?.startsWith("user") ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="User confirmed"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><polyline points="16 11 18 13 22 9" /></svg>
              ) : rainPause.source === "soil sensor" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Soil sensor"><path d="M2 22l1-1h18l1 1" /><path d="M6 18a4 4 0 014-4h4a4 4 0 014 4" /><path d="M12 10V2" /><path d="M8 6l4-4 4 4" /></svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Rain sensor"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M16.36 16.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M16.36 7.64l1.42-1.42" /></svg>
              )}
              {rainPause.triggeredAt ? formatRelativeTime(rainPause.triggeredAt) : ""}
            </span>
          )}
        </div>
        <StatusTile
          label="Soil"
          icon={getSensorIcon("soil", "sensor-icon--soil")}
          value={soilStatus}
          tone={soilTone}
          active={soilActive}
        />
      </div>
    </section>
  );
};
