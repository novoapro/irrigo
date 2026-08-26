import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Zone } from "../../types";
import type { RainPauseStatus } from "../../api";
import type { StatusTone } from "./SensorWidgets";
import { formatElapsedDuration, formatRelativeTime } from "../../utils/date";
import { getSensorIcon, type SensorDescriptor } from "../../utils/sensors";
import SystemStatusIcon from "../SystemStatusIcon";
import RainIntensityPicker from "../RainIntensityPicker";

type IrrigationStatus = {
  zone: string | null;
  action: "on" | "off" | null;
};

interface StatusPanelProps {
  guard: boolean;
  irrigation: IrrigationStatus | null;
  lastIrrigationChange: string | null;
  // Each sensor now arrives as one cohesive descriptor (status + tone + active)
  // instead of three parallel props apiece — see SensorDescriptor. `pressureDetail`
  // stays separate: it is optional and specific to the pressure tile.
  pressure: SensorDescriptor;
  pressureDetail?: string;
  rain: SensorDescriptor;
  soil: SensorDescriptor;
  zones?: Zone[];
  rainPause?: RainPauseStatus;
  onRainReported?: () => void;
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
  pressure,
  pressureDetail,
  rain,
  soil,
  zones,
  rainPause,
  onRainReported
}: StatusPanelProps) => {
  const [rainDialogOpen, setRainDialogOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startLongPress = useCallback(() => {
    longPressTimer.current = setTimeout(() => { setRainDialogOpen(true); }, 600);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  }, []);
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
          value={pressure.status}
          tone={pressure.tone}
          detail={pressureDetail}
          active={pressure.active}
        />
        <div
          className={`status-tile status-tile--pressable ${toneColorClass(rainPause?.active ? "negative" : rain.tone)}`}
          onMouseDown={startLongPress}
          onMouseUp={cancelLongPress}
          onMouseLeave={cancelLongPress}
          onTouchStart={startLongPress}
          onTouchEnd={cancelLongPress}
          onTouchCancel={cancelLongPress}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="status-tile__header">
            <span className="status-tile__icon">{getSensorIcon("rain", "sensor-icon--rain")}</span>
            <span className="status-tile__label">Rain</span>
            {rain.active ? (
              <span className="status-tile__badge status-tile__badge--on">Active</span>
            ) : (
              <span className="status-tile__badge status-tile__badge--off">Off</span>
            )}
          </div>
          <span className="status-tile__value">{rainPause?.active ? "Detected" : rain.status}</span>
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

        {rainDialogOpen && createPortal(
          <div className="modal-overlay confirm-dialog-overlay" role="dialog" aria-modal="true" onClick={() => setRainDialogOpen(false)}>
            <div className="confirm-dialog rain-report-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="confirm-dialog__icon rain-report-dialog__icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 17.58A5 5 0 0018 8h-1.26A8 8 0 104 16.25" /><path d="M12 14l-1 3" /><path d="M8 15l-1 3" /><path d="M16 15l-1 3" /></svg>
              </div>
              <h3 className="confirm-dialog__title">Report rain</h3>
              <p className="confirm-dialog__message">How heavy was the rain?</p>
              <RainIntensityPicker
                onConfirmed={() => { setRainDialogOpen(false); onRainReported?.(); }}
                onDismiss={() => setRainDialogOpen(false)}
                rainPause={rainPause}
                onPauseCleared={() => { setRainDialogOpen(false); onRainReported?.(); }}
              />
            </div>
          </div>,
          document.body
        )}
        <StatusTile
          label="Soil"
          icon={getSensorIcon("soil", "sensor-icon--soil")}
          value={soil.status}
          tone={soil.tone}
          active={soil.active}
        />
      </div>
    </section>
  );
};
