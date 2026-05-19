import { useCallback, useState } from "react";
import type { Zone, ZoneState } from "../types";
import { triggerManualRun } from "../api";

interface ManualRunPanelProps {
  zones: Zone[];
  zoneStates: Record<string, ZoneState>;
}

const ManualRunPanel = ({ zones, zoneStates }: ManualRunPanelProps) => {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ zoneId: string; commandId: string | null; error: string | null }[] | null>(null);

  const enabledZones = zones.filter((z) => z.enabled);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResults(null);
    try {
      const res = await triggerManualRun();
      setResults(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }, []);

  const totalMinutes = enabledZones.reduce((sum, z) => sum + z.defaultDurationMinutes, 0);
  const anyActive = enabledZones.some((z) => zoneStates[z.zoneId]?.isActive);

  return (
    <section className="manual-run-panel">
      <header className="manual-run-panel__header">
        <h3>Manual Run</h3>
        <button
          type="button"
          className="primary-button icon-btn"
          onClick={handleRun}
          disabled={running || enabledZones.length === 0}
          title={running ? "Running..." : "Run all zones"}
          aria-label={running ? "Running..." : "Run all zones"}
        >
          {running ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
          )}
        </button>
      </header>

      <p className="manual-run-panel__subtitle muted">
        Runs all enabled zones sequentially using their default durations.
        {enabledZones.length > 0 && ` Total: ~${totalMinutes} min across ${enabledZones.length} zone${enabledZones.length !== 1 ? "s" : ""}.`}
      </p>

      {error && <p className="zone-control-panel__error">{error}</p>}

      {anyActive && (
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
            const resultEntry = results?.find((r) => r.zoneId === zone.zoneId);
            return (
              <div className="manual-run-zone" key={zone.zoneId}>
                <span className="manual-run-zone__name">{zone.name}</span>
                <span className="manual-run-zone__duration">{zone.defaultDurationMinutes} min</span>
                {state?.isActive && (
                  <span className="schedule-status-pill schedule-status-pill--executing">active</span>
                )}
                {resultEntry && !resultEntry.error && (
                  <span className="schedule-status-pill schedule-status-pill--completed">sent</span>
                )}
                {resultEntry?.error && (
                  <span className="schedule-status-pill schedule-status-pill--error" title={resultEntry.error}>failed</span>
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
