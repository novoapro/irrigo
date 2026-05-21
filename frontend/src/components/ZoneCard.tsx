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

export interface AwaitingConfirmation {
  expectedActive: boolean;
  durationMinutes?: number;
}

interface ZoneCardProps {
  zone: Zone;
  state: ZoneState | null;
  onEdit?: (zone: Zone) => void;
  onToggleEnabled: (zoneId: string) => void;
  onCommand: (zoneId: string, action: "on" | "off", durationMinutes?: number) => void;
  commandPending: boolean;
  awaitingConfirmation: AwaitingConfirmation | null;
  lastIrrigation: ZoneIrrigationSummary | null;
  baselinePsi?: number | null;
}

const formatCountdown = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const ZoneCard = ({ zone, state, onEdit, onToggleEnabled, onCommand, commandPending, awaitingConfirmation, lastIrrigation, baselinePsi }: ZoneCardProps) => {
  const isActive = state?.isActive ?? false;
  const [selectedDuration, setSelectedDuration] = useState(zone.defaultDurationMinutes);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<number | null>(null);

  useEffect(() => {
    setSelectedDuration(zone.defaultDurationMinutes);
  }, [zone.defaultDurationMinutes]);

  const activeDuration = state?.activeDurationMinutes
    ?? awaitingConfirmation?.durationMinutes
    ?? selectedDuration;

  useEffect(() => {
    if (countdownRef.current != null) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    if (!isActive || !state?.lastEventAt) {
      setCountdown(null);
      return;
    }

    const startMs = new Date(state.lastEventAt).getTime();
    const totalMs = activeDuration * 60_000;

    const tick = () => {
      const elapsed = Date.now() - startMs;
      const remaining = Math.max(0, Math.ceil((totalMs - elapsed) / 1000));
      setCountdown(remaining);
      if (remaining <= 0 && countdownRef.current != null) {
        window.clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };

    tick();
    countdownRef.current = window.setInterval(tick, 1000);

    return () => {
      if (countdownRef.current != null) {
        window.clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [isActive, state?.lastEventAt, activeDuration]);

  const handleToggle = useCallback(() => {
    if (isActive) {
      onCommand(zone.zoneId, "off");
    } else {
      onCommand(zone.zoneId, "on", selectedDuration);
    }
  }, [isActive, zone.zoneId, selectedDuration, onCommand]);

  const totalSeconds = activeDuration * 60;
  const progress = countdown != null && totalSeconds > 0
    ? 1 - (countdown / totalSeconds)
    : 0;

  const cardClass = [
    "zone-card",
    isActive ? "zone-card--active" : "",
    zone.enabled && !isActive ? "zone-card--enabled" : "",
    !zone.enabled ? "zone-card--disabled" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const isWaiting = !!awaitingConfirmation;
  const isBusy = commandPending || isWaiting;

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
        <div className="zone-card__header-actions">
          {isWaiting && (
            <span className="zone-command-pending" title="Waiting for controller confirmation">
              <svg className="zone-command-pending__spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
            </span>
          )}
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
        </div>
      </header>

      {zone.description && (
        <p className="zone-card__description muted">{zone.description}</p>
      )}

      <div className="zone-card__controls">
        <button
          type="button"
          className={`zone-toggle-btn ${isActive ? "zone-toggle-btn--on" : "zone-toggle-btn--off"}`}
          onClick={handleToggle}
          disabled={!zone.enabled || (isActive ? commandPending : isBusy)}
          title={isActive ? "Stop irrigation" : "Start irrigation"}
          aria-label={isActive ? `Stop ${zone.name}` : `Start ${zone.name}`}
        >
          {commandPending ? (
            <svg className="icon-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
          ) : isActive ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
          )}
        </button>

        <div className="zone-card__panel-slot">
          <div className={`zone-card__panel-duration${isActive ? " zone-card__panel--hidden" : ""}`}>
            {zone.enabled && (
              <Dropdown
                value={String(selectedDuration)}
                options={DURATION_OPTS.map((d) => ({
                  value: String(d),
                  label: `${d} min${d === zone.defaultDurationMinutes ? " (default)" : ""}`
                }))}
                onChange={(v) => setSelectedDuration(parseInt(v, 10))}
              />
            )}
          </div>
          <div className={`zone-card__panel-progress${isActive ? "" : " zone-card__panel--hidden"}`}>
            <div className="zone-card__active-bar">
              <div className="zone-card__active-bar-fill" style={{ width: `${Math.min(progress * 100, 100)}%` }} />
              <span className="zone-card__countdown">
                {countdown != null && countdown > 0 ? formatCountdown(countdown) : "0:00"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {lastIrrigation && !lastIrrigation.isRunning && (
        <div className="zone-card__irrigation">
          <div className="zone-card__irrigation-row">
            <span className="zone-card__irrigation-label">Last run</span>
            <span className="zone-card__irrigation-elapsed">
              {formatTimestampShort(lastIrrigation.start)}
            </span>
          </div>
          <div className="zone-card__irrigation-stats">
            {lastIrrigation.durationMs > 0 && (
              <span className="zone-card__irrigation-duration">{formatDurationLabel(lastIrrigation.durationMs)}</span>
            )}
            {lastIrrigation.pressureStart !== null && (
              <span className={`zone-card__irrigation-psi${baselinePsi != null && lastIrrigation.pressureStart < baselinePsi ? " zone-card__irrigation-psi--low" : ""}`}>
                {lastIrrigation.pressureStart.toFixed(1)} psi
              </span>
            )}
            {lastIrrigation.pressureEnd !== null && (
              <>
                <span className="zone-card__irrigation-arrow">&rarr;</span>
                <span className={`zone-card__irrigation-psi${baselinePsi != null && lastIrrigation.pressureEnd < baselinePsi ? " zone-card__irrigation-psi--low" : ""}`}>
                  {lastIrrigation.pressureEnd.toFixed(1)} psi
                </span>
              </>
            )}
          </div>
        </div>
      )}

      <footer className="zone-card__footer">
        {!lastIrrigation && state?.lastEventAt && !isActive && (
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
