import { useCallback, useEffect, useRef, useState } from "react";
import type { Zone, ZoneState } from "../types";
import { formatDurationLabel, formatElapsedSince, formatTimestampShort } from "../utils/date";
import Dropdown from "./Dropdown";

const DURATION_OPTS = [5, 10, 15, 20, 30, 45, 60];

export interface ZoneIrrigationSummary {
  start: string;
  end: string | null;
  durationMs: number;
  isRunning: boolean;
  pressureStart: number | null;
  pressureEnd: number | null;
}

interface ZoneCardProps {
  zone: Zone;
  state: ZoneState | null;
  onEdit?: (zone: Zone) => void;
  onToggleEnabled: (zoneId: string) => void;
  onCommand: (zoneId: string, action: "on" | "off", durationMinutes?: number) => void;
  commandPending: boolean;
  lastIrrigation: ZoneIrrigationSummary | null;
  baselinePsi?: number | null;
}

const RING_RADIUS = 18;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const ZoneCard = ({ zone, state, onEdit, onToggleEnabled, onCommand, commandPending, lastIrrigation, baselinePsi }: ZoneCardProps) => {
  const isActive = state?.isActive ?? false;
  const [selectedDuration, setSelectedDuration] = useState(zone.defaultDurationMinutes);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setSelectedDuration(zone.defaultDurationMinutes);
  }, [zone.defaultDurationMinutes]);

  useEffect(() => {
    if (state?.remainingSeconds != null && state.remainingSeconds > 0) {
      setRemainingSeconds(state.remainingSeconds);
    } else if (!isActive) {
      setRemainingSeconds(null);
    }
  }, [state?.remainingSeconds, isActive]);

  useEffect(() => {
    if (remainingSeconds != null && remainingSeconds > 0) {
      timerRef.current = window.setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev == null || prev <= 1) return null;
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [remainingSeconds != null && remainingSeconds > 0]);

  const handleToggle = useCallback(() => {
    if (isActive) {
      onCommand(zone.zoneId, "off");
    } else {
      onCommand(zone.zoneId, "on", selectedDuration);
    }
  }, [isActive, zone.zoneId, selectedDuration, onCommand]);

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const totalSeconds = (state?.activeDurationMinutes ?? selectedDuration) * 60;
  const progress = remainingSeconds != null && totalSeconds > 0
    ? 1 - (remainingSeconds / totalSeconds)
    : 0;

  const cardClass = [
    "zone-card",
    isActive ? "zone-card--active" : "",
    zone.enabled && !isActive ? "zone-card--enabled" : "",
    !zone.enabled ? "zone-card--disabled" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={cardClass}>
      <header className="zone-card__header">
        <div className="zone-card__title-row">
          <h4 className="zone-card__name">{zone.name}</h4>
          <div className="zone-card__badges">
            {!zone.enabled && (
              <span className="zone-badge zone-badge--disabled">Disabled</span>
            )}
            {isActive && (
              <span className="zone-badge zone-badge--active">Active</span>
            )}
          </div>
        </div>
        {onEdit && (
          <button
            type="button"
            className="zone-card__edit-btn"
            onClick={() => onEdit(zone)}
            title="Edit zone"
            aria-label={`Edit ${zone.name}`}
          >
            <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zm-1.207 1.207L3 14.172V17h2.828l9.38-9.379-2.83-2.828z" />
            </svg>
          </button>
        )}
      </header>

      {zone.description && (
        <p className="zone-card__description muted">{zone.description}</p>
      )}

      <div className="zone-card__controls">
        <button
          type="button"
          className={`zone-toggle-btn ${isActive ? "zone-toggle-btn--on" : "zone-toggle-btn--off"}`}
          onClick={handleToggle}
          disabled={!zone.enabled || commandPending}
          title={isActive ? "Turn off" : "Turn on"}
        >
          {commandPending ? "..." : isActive ? "ON" : "OFF"}
        </button>

        {!isActive && zone.enabled && (
          <div className="zone-card__duration">
            <Dropdown
              value={String(selectedDuration)}
              options={DURATION_OPTS.map((d) => ({
                value: String(d),
                label: `${d} min${d === zone.defaultDurationMinutes ? " (default)" : ""}`
              }))}
              onChange={(v) => setSelectedDuration(parseInt(v, 10))}
            />
          </div>
        )}

        {isActive && remainingSeconds != null && remainingSeconds > 0 && (
          <div className="zone-progress-ring-wrapper">
            <svg className="zone-progress-ring" viewBox="0 0 44 44">
              <circle className="zone-progress-ring__bg" cx="22" cy="22" r={RING_RADIUS} />
              <circle
                className="zone-progress-ring__fill"
                cx="22" cy="22" r={RING_RADIUS}
                style={{
                  strokeDasharray: RING_CIRCUMFERENCE,
                  strokeDashoffset: RING_CIRCUMFERENCE * (1 - progress)
                }}
              />
            </svg>
            <span className="countdown-timer">{formatCountdown(remainingSeconds)}</span>
          </div>
        )}
      </div>

      {lastIrrigation && (
        <div className="zone-card__irrigation">
          <div className="zone-card__irrigation-row">
            <span className="zone-card__irrigation-label">Last run</span>
            <span className="zone-card__irrigation-elapsed">
              {lastIrrigation.isRunning
                ? "Running now"
                : formatTimestampShort(lastIrrigation.start)}
            </span>
          </div>
          <div className="zone-card__irrigation-stats">
            {lastIrrigation.durationMs > 0 && !lastIrrigation.isRunning && (
              <span className="zone-card__irrigation-duration">{formatDurationLabel(lastIrrigation.durationMs)}</span>
            )}
            {lastIrrigation.pressureStart !== null && (
              <span className={`zone-card__irrigation-psi${baselinePsi != null && lastIrrigation.pressureStart < baselinePsi ? " zone-card__irrigation-psi--low" : ""}`}>
                {lastIrrigation.pressureStart.toFixed(1)} psi
              </span>
            )}
            {lastIrrigation.pressureEnd !== null && !lastIrrigation.isRunning && (
              <>
                <span className="zone-card__irrigation-arrow">→</span>
                <span className={`zone-card__irrigation-psi${baselinePsi != null && lastIrrigation.pressureEnd < baselinePsi ? " zone-card__irrigation-psi--low" : ""}`}>
                  {lastIrrigation.pressureEnd.toFixed(1)} psi
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <footer className="zone-card__footer">
        {!lastIrrigation && state?.lastEventAt && (
          <span className="zone-card__last-activity muted">
            Last: {formatElapsedSince(state.lastEventAt) ?? "—"}
          </span>
        )}
        {zone.metadata?.plantType && (
          <span className="zone-card__meta-tag zone-card__meta-tag--plant">{zone.metadata.plantType}</span>
        )}
        {zone.metadata?.sunExposure && (
          <span className="zone-card__meta-tag zone-card__meta-tag--sun">{zone.metadata.sunExposure} sun</span>
        )}
      </footer>
    </article>
  );
};

export default ZoneCard;
