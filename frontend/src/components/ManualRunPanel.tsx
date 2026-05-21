import { useCallback, useEffect, useRef, useState } from "react";
import type { ManualRun, Zone, ZoneState } from "../types";
import { triggerManualRun, cancelManualRun, getManualRunStatus, updateZone } from "../api";

interface ManualRunPanelProps {
  zones: Zone[];
  zoneStates: Record<string, ZoneState>;
  onZonesChanged: () => void;
  manualRun: ManualRun | null;
}

const ManualRunPanel = ({ zones, zoneStates, onZonesChanged, manualRun }: ManualRunPanelProps) => {
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingZone, setTogglingZone] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const isRunActive = manualRun?.status === "running";

  const enabledZones = zones.filter((z) => z.enabled);
  const eligibleZones = enabledZones.filter((z) => !z.excludeFromManualRun);

  const handleRun = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      await triggerManualRun();
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }, []);

  const handleCancel = useCallback(async () => {
    setCancelling(true);
    setError(null);
    try {
      await cancelManualRun();
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      if (mountedRef.current) setCancelling(false);
    }
  }, []);

  const handleToggleExclude = useCallback(async (zone: Zone) => {
    if (isRunActive) return;
    setTogglingZone(zone.zoneId);
    try {
      await updateZone(zone.zoneId, { excludeFromManualRun: !zone.excludeFromManualRun });
      onZonesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      if (mountedRef.current) setTogglingZone(null);
    }
  }, [isRunActive, onZonesChanged]);

  const totalMinutes = eligibleZones.reduce((sum, z) => sum + z.defaultDurationMinutes, 0);
  const anyActive = enabledZones.some((z) => zoneStates[z.zoneId]?.isActive);

  const getRunZoneStatus = (zoneId: string) => {
    if (!manualRun) return null;
    return manualRun.zones.find((z) => z.zoneId === zoneId) ?? null;
  };

  const statusPillClass = (status: string) => {
    const map: Record<string, string> = {
      queued: "planned",
      activating: "queued",
      running: "executing",
      completed: "completed",
      skipped: "skipped",
      failed: "error"
    };
    return `schedule-status-pill schedule-status-pill--${map[status] ?? status}`;
  };

  return (
    <section className="manual-run-panel">
      <header className="manual-run-panel__header">
        <h3>Manual Run</h3>
        <div className="manual-run-panel__actions">
          {isRunActive ? (
            <button
              type="button"
              className="danger-button icon-btn"
              onClick={handleCancel}
              disabled={cancelling}
              title="Cancel run"
              aria-label="Cancel manual run"
            >
              {cancelling ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
              )}
            </button>
          ) : (
            <button
              type="button"
              className="primary-button icon-btn"
              onClick={handleRun}
              disabled={starting || eligibleZones.length === 0}
              title={starting ? "Starting..." : "Run all zones"}
              aria-label={starting ? "Starting..." : "Run all zones"}
            >
              {starting ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              )}
            </button>
          )}
        </div>
      </header>

      <p className="manual-run-panel__subtitle muted">
        {isRunActive
          ? "Sequential run in progress. Zones execute one at a time."
          : "Runs included zones sequentially using their default durations."}
        {!isRunActive && eligibleZones.length > 0 && ` Total: ~${totalMinutes} min across ${eligibleZones.length} zone${eligibleZones.length !== 1 ? "s" : ""}.`}
      </p>

      {error && <p className="zone-control-panel__error">{error}</p>}

      {!isRunActive && anyActive && (
        <p className="manual-run-panel__active-notice">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          Some zones are currently active.
        </p>
      )}

      {enabledZones.length === 0 ? (
        <p className="muted">No enabled zones. Add zones in Settings to get started.</p>
      ) : (
        <div className="manual-run-panel__zones">
          {enabledZones.map((zone) => {
            const state = zoneStates[zone.zoneId];
            const runZone = getRunZoneStatus(zone.zoneId);
            const isExcluded = zone.excludeFromManualRun === true;
            const isToggling = togglingZone === zone.zoneId;

            return (
              <div className={`manual-run-zone${isExcluded && !isRunActive ? " manual-run-zone--excluded" : ""}`} key={zone.zoneId}>
                {!isRunActive && (
                  <label className="manual-run-zone__toggle" title={isExcluded ? "Include in manual run" : "Exclude from manual run"}>
                    <input
                      type="checkbox"
                      checked={!isExcluded}
                      onChange={() => handleToggleExclude(zone)}
                      disabled={isToggling}
                    />
                  </label>
                )}
                <span className={`manual-run-zone__name${isExcluded && !isRunActive ? " muted" : ""}`}>{zone.name}</span>
                <span className="manual-run-zone__duration">{zone.defaultDurationMinutes} min</span>

                {isRunActive && runZone && (
                  <span className={statusPillClass(runZone.status)}>
                    {runZone.status}
                  </span>
                )}

                {!isRunActive && state?.isActive && (
                  <span className="schedule-status-pill schedule-status-pill--executing">active</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default ManualRunPanel;
