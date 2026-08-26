import { useCallback, useState } from "react";
import type { SequentialRunZoneEntry, Zone, ZoneState } from "../types";
import { formatDurationLabel, formatElapsedSince, formatTimestampShort } from "../utils/date";
import { useNow } from "../hooks/useNow";

const MIN_DURATION = 1;
const MAX_DURATION = 60;

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
  locked?: boolean;
  manualRunActive?: boolean;
  manualRunZoneEntry?: SequentialRunZoneEntry | null;
  onToggleManualRunExclusion?: (zone: Zone) => void;
}

const formatCountdown = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const DURATION_STORAGE_KEY = "irrigo:zone-duration:";

export const getPersistedDuration = (zoneId: string, fallback: number): number => {
  try {
    const v = localStorage.getItem(DURATION_STORAGE_KEY + zoneId);
    if (v !== null) {
      const n = Number(v);
      if (n >= MIN_DURATION && n <= MAX_DURATION) return n;
    }
  } catch { /* ignore */ }
  return fallback;
};

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: "Queued",
  activating: "Activating",
  running: "Running",
  completed: "Done",
  skipped: "Skipped",
  failed: "Failed"
};

const RUN_STATUS_CLASS: Record<string, string> = {
  queued: "planned",
  activating: "queued",
  running: "executing",
  completed: "completed",
  skipped: "skipped",
  failed: "error"
};

const ZoneCard = ({ zone, state, onEdit, onToggleEnabled, onCommand, commandPending, awaitingConfirmation, lastIrrigation, baselinePsi, locked, manualRunActive, manualRunZoneEntry, onToggleManualRunExclusion }: ZoneCardProps) => {
  const isActive = state?.isActive ?? false;
  const [selectedDuration, setSelectedDuration] = useState(() =>
    getPersistedDuration(zone.zoneId, zone.defaultDurationMinutes)
  );
  const handleDurationChange = useCallback((value: number) => {
    setSelectedDuration(value);
    try { localStorage.setItem(DURATION_STORAGE_KEY + zone.zoneId, String(value)); } catch { /* ignore */ }
  }, [zone.zoneId]);

  const activeDuration = state?.activeDurationMinutes
    ?? awaitingConfirmation?.durationMinutes
    ?? selectedDuration;

  // Live countdown derived from a ticking clock (only while a run is active)
  // instead of an interval + setState effect (set-state-in-effect).
  const now = useNow(isActive && state?.lastEventAt ? 1000 : null);
  const countdown = ((): number | null => {
    if (!isActive || !state?.lastEventAt) {
      return null;
    }
    if (state.remainingSeconds != null && state.remainingUpdatedAt) {
      const updatedAtMs = new Date(state.remainingUpdatedAt).getTime();
      const elapsed = (now - updatedAtMs) / 1000;
      return Math.max(0, Math.ceil(state.remainingSeconds - elapsed));
    }
    const startMs = new Date(state.lastEventAt).getTime();
    const totalMs = activeDuration * 60_000;
    return Math.max(0, Math.ceil((totalMs - (now - startMs)) / 1000));
  })();

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

  const isExcluded = zone.excludeFromManualRun === true;

  const cardClass = [
    "zone-card",
    isActive ? "zone-card--active" : "",
    zone.enabled && !isActive ? "zone-card--enabled" : "",
    !zone.enabled ? "zone-card--disabled" : "",
    !onEdit && isExcluded && !manualRunActive ? "zone-card--excluded" : ""
  ]
    .filter(Boolean)
    .join(" ");

  const isWaiting = !!awaitingConfirmation;
  const runZoneActivating = manualRunZoneEntry?.status === "activating";
  const runZoneRunning = manualRunZoneEntry?.status === "running";
  const isBusy = commandPending || isWaiting || runZoneActivating;

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
            {!onEdit && manualRunZoneEntry && (
              <span className={`schedule-status-pill schedule-status-pill--${RUN_STATUS_CLASS[manualRunZoneEntry.status] ?? manualRunZoneEntry.status}`}>
                {RUN_STATUS_LABELS[manualRunZoneEntry.status] ?? manualRunZoneEntry.status}
              </span>
            )}
          </div>
        </div>
        <div className="zone-card__header-actions">
          {(isWaiting || runZoneActivating) && (
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
          {!onEdit && onToggleManualRunExclusion && zone.enabled && (
            <label
              className={`zone-card__run-toggle${!isExcluded ? " zone-card__run-toggle--on" : ""}${manualRunActive ? " zone-card__run-toggle--locked" : ""}`}
              title={isExcluded ? "Include in manual run" : "Exclude from manual run"}
            >
              <input
                type="checkbox"
                checked={!isExcluded}
                onChange={() => onToggleManualRunExclusion(zone)}
                disabled={!!manualRunActive}
              />
              <span className="zone-card__run-toggle-track">
                <span className="zone-card__run-toggle-thumb" />
              </span>
            </label>
          )}
        </div>
      </header>

      {zone.description && (
        <p className="zone-card__description muted">{zone.description}</p>
      )}

      {!onEdit && (
        <div className="zone-card__controls">
          <button
            type="button"
            className={`zone-toggle-btn ${isActive || runZoneRunning ? "zone-toggle-btn--on" : "zone-toggle-btn--off"}`}
            onClick={handleToggle}
            disabled={!zone.enabled || isBusy || !!manualRunActive}
            title={isActive ? "Stop irrigation" : "Start irrigation"}
            aria-label={isActive ? `Stop ${zone.name}` : `Start ${zone.name}`}
          >
            {commandPending || runZoneActivating ? (
              <svg className="icon-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              </svg>
            ) : isActive || runZoneRunning ? (
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
                <div className="zone-duration-slider">
                  <div
                    className="zone-duration-slider__fill"
                    style={{
                      width: `${((selectedDuration - MIN_DURATION) / (MAX_DURATION - MIN_DURATION)) * 100}%`,
                      background: `rgba(var(--slider-fill-r), var(--slider-fill-g), var(--slider-fill-b), ${0.12 + ((selectedDuration - MIN_DURATION) / (MAX_DURATION - MIN_DURATION)) * 0.28})`
                    }}
                  />
                  <input
                    type="range"
                    className="zone-duration-slider__input"
                    min={MIN_DURATION}
                    max={MAX_DURATION}
                    step={1}
                    value={selectedDuration}
                    onChange={(e) => handleDurationChange(Number(e.target.value))}
                    disabled={locked || isActive || !!manualRunActive}
                  />
                  <span className="zone-duration-slider__label">{selectedDuration} min</span>
                </div>
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
      )}

      {!onEdit && lastIrrigation && !lastIrrigation.isRunning && (
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
        {!onEdit && !lastIrrigation && state?.lastEventAt && !isActive && (
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
