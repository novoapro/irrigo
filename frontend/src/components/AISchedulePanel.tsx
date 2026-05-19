import { useCallback, useEffect, useState } from "react";
import type { AIScheduleConfig, ScheduleEntry, ScheduleRun, Zone } from "../types";
import {
  fetchAIScheduleConfig,
  fetchUpcomingEntries,
  fetchScheduleRuns,
  fetchScheduleRun,
  triggerAIScheduleRun,
  cancelScheduleEntry,
  skipScheduleEntry
} from "../api";

interface AISchedulePanelProps {
  zones: Zone[];
  onScheduleChanged: () => void;
  onOpenSettings?: () => void;
}

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
};

const extractErrorMessage = (run: ScheduleRun): string => {
  if (!run.errorMessage) return "Unknown error";
  try {
    const parsed = JSON.parse(run.errorMessage);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed.message ?? parsed.error ?? parsed.msg ?? run.errorMessage;
    }
  } catch {
    // not JSON
  }
  return run.errorMessage;
};

const EntryCard = ({
  entry,
  zoneName,
  onSkip,
  onCancel,
  compact
}: {
  entry: ScheduleEntry;
  zoneName: string;
  onSkip?: (id: string) => void;
  onCancel?: (id: string) => void;
  compact?: boolean;
}) => (
  <div className={`schedule-entry-card${compact ? " schedule-entry-card--compact" : ""}`}>
    <div className="schedule-entry-card__top">
      <span className={`schedule-status-pill schedule-status-pill--${entry.status}`}>
        {entry.status}
      </span>
      <span className="schedule-entry-card__zone">{zoneName}</span>
      <span className="schedule-entry-card__duration">{entry.plannedDurationMinutes} min</span>
    </div>
    <div className="schedule-entry-card__time">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      <span>{formatDate(entry.plannedStartAt)}</span>
    </div>
    {entry.aiReasoning && (
      <p className="schedule-entry-card__reasoning">{entry.aiReasoning}</p>
    )}
    {entry.weatherContext && (entry.weatherContext.precipitationProbability != null || entry.weatherContext.forecastSummary) && (
      <div className="schedule-entry-card__weather">
        {entry.weatherContext.precipitationProbability != null && (
          <span className="schedule-entry-card__weather-tag">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" /></svg>
            {entry.weatherContext.precipitationProbability}%
          </span>
        )}
        {entry.weatherContext.forecastSummary && (
          <span className="schedule-entry-card__weather-text muted">{entry.weatherContext.forecastSummary}</span>
        )}
        {entry.weatherContext.recentRainDetected && (
          <span className="schedule-entry-card__weather-tag schedule-entry-card__weather-tag--rain">Rain detected</span>
        )}
      </div>
    )}
    {entry.status === "skipped" && entry.skipReason && (
      <p className="schedule-entry-card__skip muted">{entry.skipReason}</p>
    )}
    {entry.status === "planned" && onSkip && onCancel && (
      <div className="schedule-entry-card__actions">
        <button
          type="button"
          className="ghost-button icon-btn"
          onClick={() => onSkip(entry._id)}
          title="Skip"
          aria-label="Skip entry"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg>
        </button>
        <button
          type="button"
          className="ghost-button icon-btn danger-text"
          onClick={() => onCancel(entry._id)}
          title="Cancel"
          aria-label="Cancel entry"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
    )}
  </div>
);

const AISchedulePanel = ({ zones, onScheduleChanged, onOpenSettings }: AISchedulePanelProps) => {
  const [config, setConfig] = useState<AIScheduleConfig | null>(null);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [recentRuns, setRecentRuns] = useState<ScheduleRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runEntries, setRunEntries] = useState<Record<string, ScheduleEntry[]>>({});
  const [loadingRun, setLoadingRun] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [cfg, upcoming, runs] = await Promise.all([
        fetchAIScheduleConfig(),
        fetchUpcomingEntries(),
        fetchScheduleRuns(1)
      ]);
      setConfig(cfg);
      setEntries(upcoming);
      setRecentRuns(runs.data);
    } catch (err) {
      console.error("Failed to load AI schedule data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRunNow = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      await triggerAIScheduleRun();
      void loadData();
      onScheduleChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }, [loadData, onScheduleChanged]);

  const handleCancel = useCallback(async (entryId: string) => {
    try {
      await cancelScheduleEntry(entryId);
      void loadData();
    } catch (err) {
      console.error("Failed to cancel entry:", err);
    }
  }, [loadData]);

  const handleSkip = useCallback(async (entryId: string) => {
    try {
      await skipScheduleEntry(entryId, "Manually skipped");
      void loadData();
    } catch (err) {
      console.error("Failed to skip entry:", err);
    }
  }, [loadData]);

  const handleToggleRun = useCallback(async (runId: string) => {
    if (expandedRun === runId) {
      setExpandedRun(null);
      return;
    }
    setExpandedRun(runId);
    if (!runEntries[runId]) {
      setLoadingRun(runId);
      try {
        const detail = await fetchScheduleRun(runId);
        setRunEntries((prev) => ({
          ...prev,
          [runId]: Array.isArray(detail.entries) ? detail.entries : []
        }));
      } catch {
        setRunEntries((prev) => ({ ...prev, [runId]: [] }));
      } finally {
        setLoadingRun(null);
      }
    }
  }, [expandedRun, runEntries]);

  const getZoneName = (zoneId: string) => {
    const zone = zones.find((z) => z.zoneId === zoneId);
    return zone?.name ?? zoneId;
  };

  return (
    <section className="ai-schedule-panel">
      <header className="ai-schedule-panel__header">
        <h3>Smart Scheduling</h3>
        <div className="ai-schedule-panel__actions">
          {onOpenSettings && (
            <button
              type="button"
              className="ghost-button icon-btn"
              onClick={onOpenSettings}
              title="Configure"
              aria-label="Configure AI scheduling"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
          )}
          <button
            type="button"
            className="primary-button icon-btn"
            onClick={handleRunNow}
            disabled={running || !config?.enabled}
            title={running ? "Running..." : "Run now"}
            aria-label={running ? "Running..." : "Run AI scheduler now"}
          >
            {running ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            )}
          </button>
        </div>
      </header>

      <p className="ai-schedule-panel__subtitle muted">
        {config?.enabled
          ? `${config.provider} / ${config.model}`
          : "Not configured"}
        {config?.lastRunAt && (
          <>
            {" · Last: "}
            {formatTime(config.lastRunAt)}
            {" "}
            <span className={`schedule-status-pill schedule-status-pill--${config.lastRunStatus ?? "unknown"}`}>
              {config.lastRunStatus ?? "—"}
            </span>
          </>
        )}
      </p>

      {error && <p className="zone-control-panel__error">{error}</p>}

      {loading ? (
        <p className="muted">Loading schedule...</p>
      ) : entries.length === 0 && recentRuns.length === 0 ? (
        <div className="ai-schedule-empty">
          <p className="muted">
            {config?.enabled
              ? "No scheduled entries yet. Run the AI scheduler to create a plan."
              : "Enable AI scheduling in settings to get started."}
          </p>
        </div>
      ) : (
        <>
          {entries.length > 0 && (
            <div className="schedule-entries-list">
              <h4>Upcoming</h4>
              <div className="schedule-entries-grid">
                {entries.map((entry) => (
                  <EntryCard
                    key={entry._id}
                    entry={entry}
                    zoneName={getZoneName(entry.zoneId)}
                    onSkip={handleSkip}
                    onCancel={handleCancel}
                  />
                ))}
              </div>
            </div>
          )}

          {recentRuns.length > 0 && (
            <div className="schedule-runs-list">
              <h4>Run History</h4>
              {recentRuns.slice(0, 5).map((run) => {
                const isExpanded = expandedRun === run.scheduleRunId;
                const isLoading = loadingRun === run.scheduleRunId;
                const entriesForRun = runEntries[run.scheduleRunId];
                return (
                  <div
                    className={`schedule-run${isExpanded ? " schedule-run--expanded" : ""}`}
                    key={run.scheduleRunId}
                  >
                    <button
                      type="button"
                      className="schedule-run__header"
                      onClick={() => void handleToggleRun(run.scheduleRunId)}
                    >
                      <span className={`schedule-run__chevron${isExpanded ? " schedule-run__chevron--open" : ""}`}>
                        <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor">
                          <path d="M6.293 7.293a1 1 0 011.414 0L10 9.586l2.293-2.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" />
                        </svg>
                      </span>
                      <span className={`schedule-status-pill schedule-status-pill--${run.status}`}>
                        {run.status}
                      </span>
                      <span className="schedule-run__time">{formatDate(run.startedAt)}</span>
                      <span className="schedule-run__meta muted">
                        {run.triggeredBy === "cron" ? "auto" : "manual"}
                        {typeof run.entries === "number" && run.entries > 0 ? ` · ${run.entries} zone${run.entries !== 1 ? "s" : ""}` : ""}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="schedule-run__body">
                        {run.status === "error" && (
                          <div className="schedule-run__error">
                            {extractErrorMessage(run)}
                          </div>
                        )}
                        {run.reasoning && run.status !== "error" && (
                          <p className="schedule-run__reasoning">{run.reasoning}</p>
                        )}
                        {isLoading ? (
                          <p className="muted">Loading entries...</p>
                        ) : entriesForRun && entriesForRun.length > 0 ? (
                          <div className="schedule-run__entries">
                            {entriesForRun.map((entry) => (
                              <EntryCard
                                key={entry._id}
                                entry={entry}
                                zoneName={getZoneName(entry.zoneId)}
                                compact
                              />
                            ))}
                          </div>
                        ) : entriesForRun && entriesForRun.length === 0 && run.status !== "error" ? (
                          <p className="muted">No entries were created for this run.</p>
                        ) : null}
                        {run.promptTokens != null && (
                          <p className="schedule-run__tokens muted">
                            {run.promptTokens.toLocaleString()} prompt + {(run.completionTokens ?? 0).toLocaleString()} completion tokens
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default AISchedulePanel;
