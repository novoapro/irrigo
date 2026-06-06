import { useCallback, useEffect, useState } from "react";
import type { AIScheduleConfig, IrrigationProgram, ScheduleEntry, ScheduleRun, Zone } from "../types";
import {
  fetchAIScheduleConfig,
  fetchPrograms,
  fetchScheduleRuns,
  fetchScheduleRun,
  triggerAIScheduleRun,
  cancelAIProgram
} from "../api";
import AIInteractionModal from "./AIInteractionModal";

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
    {entry.status === "deferred" && (
      <div className="schedule-entry-card__deferral">
        <p className="schedule-entry-card__skip muted">
          {entry.deferralReason ?? "Guard active — waiting for conditions to improve"}
        </p>
        {entry.deferralDeadline && (
          <p className="schedule-entry-card__skip muted">
            Deadline: {formatDate(entry.deferralDeadline)}
          </p>
        )}
      </div>
    )}
    {(entry.status === "planned" || entry.status === "deferred") && onSkip && onCancel && (
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
  const [aiPrograms, setAiPrograms] = useState<IrrigationProgram[]>([]);
  const [recentRuns, setRecentRuns] = useState<ScheduleRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runEntries, setRunEntries] = useState<Record<string, ScheduleEntry[]>>({});
  const [loadingRun, setLoadingRun] = useState<string | null>(null);
  const [interactionRun, setInteractionRun] = useState<ScheduleRun | null>(null);
  const [loadingInteraction, setLoadingInteraction] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [cfg, progs, runs] = await Promise.all([
        fetchAIScheduleConfig(),
        fetchPrograms({ source: "ai-schedule", status: ["planned", "executing", "deferred"] }),
        fetchScheduleRuns(1)
      ]);
      setConfig(cfg);
      setAiPrograms(progs);
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

  const handleCancelProgram = useCallback(async (programId: string) => {
    try {
      await cancelAIProgram(programId);
      void loadData();
    } catch (err) {
      console.error("Failed to cancel program:", err);
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

  const handleViewInteraction = useCallback(async (runId: string) => {
    setLoadingInteraction(runId);
    try {
      const detail = await fetchScheduleRun(runId);
      setInteractionRun(detail);
    } catch (err) {
      console.error("Failed to load interaction:", err);
    } finally {
      setLoadingInteraction(null);
    }
  }, []);

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
            className={`icon-btn ai-run-status-btn ai-run-status-btn--${running ? "running" : config?.lastRunStatus ?? "none"}`}
            onClick={handleRunNow}
            disabled={running || !config?.enabled}
            title={running ? "Running..." : config?.lastRunAt ? `Last run: ${formatTime(config.lastRunAt)} (${config.lastRunStatus ?? "unknown"})` : "Run now"}
            aria-label={running ? "Running..." : "Run AI Run"}
          >
            {running ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
            ) : config?.lastRunStatus === "success" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : config?.lastRunStatus === "error" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
            ) : config?.lastRunStatus === "skipped" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
            )}
          </button>
        </div>
      </header>

      <p className="ai-schedule-panel__subtitle muted">
        {config?.enabled
          ? `${config.provider} / ${config.model}`
          : "Not configured"}
        {config?.lastRunAt && ` · Last: ${formatTime(config.lastRunAt)}`}
      </p>

      {error && <p className="zone-control-panel__error">{error}</p>}

      {loading ? (
        <p className="muted">Loading schedule...</p>
      ) : !config?.enabled && aiPrograms.length === 0 && recentRuns.length === 0 ? (
        <div className="ai-schedule-empty">
          <p className="muted">Enable AI scheduling in settings to get started.</p>
        </div>
      ) : (
        <>
          {aiPrograms.length === 0 && recentRuns.length === 0 && (
            <div className="ai-schedule-empty">
              <p className="muted">No scheduled programs yet. Run the AI scheduler to create a plan.</p>
            </div>
          )}
          {aiPrograms.length > 0 && (
            <div className="schedule-entries-list">
              <h4>Upcoming Programs</h4>
              <div className="schedule-entries-grid">
                {aiPrograms.map((program) => (
                  <div key={program.programId} className="schedule-entry-card">
                    <div className="schedule-entry-card__header">
                      <span className={`schedule-status-pill schedule-status-pill--${program.status === "planned" ? "planned" : program.status}`}>
                        {program.status}
                      </span>
                      <span className="schedule-entry-card__zone">{program.name}</span>
                      <span className="schedule-entry-card__time">{program.plannedStartAt ? formatTime(program.plannedStartAt) : ""}</span>
                    </div>
                    <div className="schedule-entry-card__zones muted">
                      {program.zoneEntries.map((ze) => `${getZoneName(ze.zoneId)} (${ze.durationMinutes}min)`).join(", ")}
                    </div>
                    {program.aiReasoning && (
                      <p className="schedule-entry-card__reasoning muted">{program.aiReasoning}</p>
                    )}
                    {program.status === "planned" && (
                      <div className="schedule-entry-card__actions">
                        <button type="button" className="ghost-button" onClick={() => void handleCancelProgram(program.programId)}>
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
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
                        <button
                          type="button"
                          className="ghost-button schedule-run__view-interaction"
                          onClick={() => void handleViewInteraction(run.scheduleRunId)}
                          disabled={loadingInteraction === run.scheduleRunId}
                        >
                          {loadingInteraction === run.scheduleRunId ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                          )}
                          View Interaction
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      {interactionRun && (
        <AIInteractionModal
          run={interactionRun}
          onClose={() => setInteractionRun(null)}
        />
      )}
    </section>
  );
};

export default AISchedulePanel;
