import { useCallback, useEffect, useState } from "react";
import type { AIScheduleConfig, IrrigationMode, IrrigationProgram, ScheduleEntry, ScheduleRun, Zone } from "../types";
import {
  fetchAIScheduleConfig,
  fetchUpcomingEntries,
  fetchScheduleRuns,
  fetchScheduleRun,
  cancelScheduleEntry,
  skipScheduleEntry,
  fetchPrograms,
  runProgram,
  updateSystemConfig
} from "../api";

interface IrrigationQueuePanelProps {
  zones: Zone[];
  irrigationMode: IrrigationMode;
  aiScheduleEnabled: boolean;
  onModeChanged: (mode: IrrigationMode) => void;
  onScheduleChanged: () => void;
  onOpenSmartSettings: () => void;
  onOpenProgramSettings: () => void;
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

const formatSchedule = (cron: string): string => {
  const parts = cron.trim().split(/\s+/);
  const hour = parseInt(parts[1] ?? "0", 10);
  const timeStr = `${hour.toString().padStart(2, "0")}:00`;
  const dayOfMonth = parts[2] ?? "*";
  const dayOfWeek = parts[4] ?? "*";
  if (dayOfWeek !== "*") return `Weekly Mon ${timeStr}`;
  if (dayOfMonth === "*/3") return `Every 3d ${timeStr}`;
  if (dayOfMonth === "*/2") return `Every 2d ${timeStr}`;
  return `Daily ${timeStr}`;
};

const nextCronRun = (cron: string): Date | null => {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const minute = parseInt(parts[0]!, 10);
  const hour = parseInt(parts[1]!, 10);
  if (isNaN(minute) || isNaN(hour)) return null;

  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate <= now) candidate.setDate(candidate.getDate() + 1);
  return candidate;
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

const ProgramQueueCard = ({
  program,
  zoneNames,
  nextRun,
  onRun,
  running
}: {
  program: IrrigationProgram;
  zoneNames: string[];
  nextRun: Date | null;
  onRun: (id: string) => void;
  running: boolean;
}) => (
  <div className="schedule-entry-card">
    <div className="schedule-entry-card__top">
      <span className="schedule-status-pill schedule-status-pill--planned">
        {program.enabled ? "active" : "paused"}
      </span>
      <span className="schedule-entry-card__zone">{program.name}</span>
      <span className="schedule-entry-card__duration">
        {program.zoneEntries.reduce((sum, e) => sum + e.durationMinutes, 0)} min
      </span>
    </div>
    <div className="schedule-entry-card__time">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
      <span>{nextRun ? formatDate(nextRun.toISOString()) : formatSchedule(program.scheduleCron)}</span>
    </div>
    <div className="program-queue-zones">
      {zoneNames.map((name, i) => (
        <span className="program-card__zone-tag" key={i}>
          {name}
          <span className="program-card__zone-duration">{program.zoneEntries[i]!.durationMinutes}m</span>
        </span>
      ))}
    </div>
    <div className="schedule-entry-card__actions">
      <button
        type="button"
        className="ghost-button icon-btn"
        onClick={() => onRun(program.programId)}
        disabled={running}
        title="Run now"
        aria-label={`Run ${program.name} now`}
      >
        {running ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
        )}
      </button>
    </div>
  </div>
);

const IrrigationQueuePanel = ({
  zones,
  irrigationMode,
  aiScheduleEnabled,
  onModeChanged,
  onScheduleChanged,
  onOpenSmartSettings,
  onOpenProgramSettings
}: IrrigationQueuePanelProps) => {
  const [config, setConfig] = useState<AIScheduleConfig | null>(null);
  const [entries, setEntries] = useState<ScheduleEntry[]>([]);
  const [recentRuns, setRecentRuns] = useState<ScheduleRun[]>([]);
  const [programs, setPrograms] = useState<IrrigationProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningProgramId, setRunningProgramId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runEntries, setRunEntries] = useState<Record<string, ScheduleEntry[]>>({});
  const [loadingRun, setLoadingRun] = useState<string | null>(null);
  const [modeChanging, setModeChanging] = useState(false);

  const canToggleMode = aiScheduleEnabled;
  const activeMode = !canToggleMode ? "scheduled" : (irrigationMode === "scheduled" ? "scheduled" : "smart");

  const loadSmartData = useCallback(async () => {
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

  const loadScheduledData = useCallback(async () => {
    try {
      const data = await fetchPrograms();
      setPrograms(data);
    } catch (err) {
      console.error("Failed to load programs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    if (activeMode === "smart") {
      void loadSmartData();
    } else {
      void loadScheduledData();
    }
  }, [activeMode, loadSmartData, loadScheduledData]);

  const handleModeToggle = useCallback(async (mode: "smart" | "scheduled") => {
    if (mode === activeMode) return;
    setModeChanging(true);
    try {
      await updateSystemConfig(mode);
      onModeChanged(mode);
    } catch (err) {
      console.error("Failed to switch mode:", err);
    } finally {
      setModeChanging(false);
    }
  }, [activeMode, onModeChanged]);

  const handleCancel = useCallback(async (entryId: string) => {
    try {
      await cancelScheduleEntry(entryId);
      void loadSmartData();
    } catch (err) {
      console.error("Failed to cancel entry:", err);
    }
  }, [loadSmartData]);

  const handleSkip = useCallback(async (entryId: string) => {
    try {
      await skipScheduleEntry(entryId, "Manually skipped");
      void loadSmartData();
    } catch (err) {
      console.error("Failed to skip entry:", err);
    }
  }, [loadSmartData]);

  const handleRunProgram = useCallback(async (programId: string) => {
    setRunningProgramId(programId);
    try {
      await runProgram(programId);
      onScheduleChanged();
    } catch (err) {
      console.error("Failed to run program:", err);
    } finally {
      setRunningProgramId(null);
    }
  }, [onScheduleChanged]);

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

  const enabledPrograms = programs.filter((p) => p.enabled);

  return (
    <section className="irrigation-queue-panel">
      <header className="irrigation-queue-panel__header">
        <h3>{activeMode === "smart" ? "Smart Irrigation" : "Programmed Irrigation"}</h3>
        <div className="irrigation-queue-panel__actions">
          {canToggleMode && (
            <div
              className={`irrigation-mode-toggle${activeMode === "scheduled" ? " irrigation-mode-toggle--right" : ""}`}
              role="radiogroup"
              aria-label="Irrigation source"
            >
              <span className="irrigation-mode-toggle__thumb" />
              <button
                type="button"
                role="radio"
                aria-checked={activeMode === "smart"}
                className={`irrigation-mode-toggle__btn${activeMode === "smart" ? " irrigation-mode-toggle__btn--active" : ""}`}
                onClick={() => void handleModeToggle("smart")}
                disabled={modeChanging}
                title="Smart (AI)"
                aria-label="Smart AI scheduling"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 014 4c0 1.95-1.4 3.58-3.25 3.93V12h2.75a2.5 2.5 0 012.5 2.5v1a2.5 2.5 0 01-2.5 2.5H8.5A2.5 2.5 0 016 15.5v-1A2.5 2.5 0 018.5 12h2.75V9.93A4.002 4.002 0 018 6a4 4 0 014-4z" /><path d="M10 18v2a2 2 0 104 0v-2" /><circle cx="10" cy="6" r="0.5" fill="currentColor" /><circle cx="14" cy="6" r="0.5" fill="currentColor" /></svg>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={activeMode === "scheduled"}
                className={`irrigation-mode-toggle__btn${activeMode === "scheduled" ? " irrigation-mode-toggle__btn--active" : ""}`}
                onClick={() => void handleModeToggle("scheduled")}
                disabled={modeChanging}
                title="Scheduled"
                aria-label="Scheduled programs"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              </button>
            </div>
          )}
          <button
            type="button"
            className="ghost-button icon-btn"
            onClick={activeMode === "smart" ? onOpenSmartSettings : onOpenProgramSettings}
            title={activeMode === "smart" ? "Configure AI scheduling" : "Manage programs"}
            aria-label={activeMode === "smart" ? "Configure AI scheduling" : "Manage programs"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
          </button>
        </div>
      </header>

      {activeMode === "smart" && config && (
        <p className="irrigation-queue-panel__subtitle muted">
          {config.enabled
            ? `${config.provider} / ${config.model}`
            : "Not configured"}
          {config.lastRunAt && (
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
      )}

      {activeMode === "scheduled" && (
        <p className="irrigation-queue-panel__subtitle muted">
          {enabledPrograms.length > 0
            ? `${enabledPrograms.length} active program${enabledPrograms.length !== 1 ? "s" : ""}`
            : "No active programs. Add programs in Settings."}
        </p>
      )}

      {error && <p className="zone-control-panel__error">{error}</p>}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : activeMode === "smart" ? (
        <>
          {entries.length === 0 && recentRuns.length === 0 ? (
            <div className="irrigation-queue-empty">
              <p className="muted">
                {config?.enabled
                  ? "No scheduled entries yet. The AI scheduler will run automatically."
                  : "Enable AI scheduling in settings to get started."}
              </p>
            </div>
          ) : (
            <>
              {entries.length > 0 && (
                <div className="schedule-entries-list">
                  <h4>Queue</h4>
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
        </>
      ) : (
        <>
          {enabledPrograms.length === 0 ? (
            <div className="irrigation-queue-empty">
              <p className="muted">No active programs. Add and enable programs in Settings.</p>
            </div>
          ) : (
            <div className="schedule-entries-list">
              <h4>Queue</h4>
              <div className="schedule-entries-grid">
                {enabledPrograms.map((program) => (
                  <ProgramQueueCard
                    key={program.programId}
                    program={program}
                    zoneNames={program.zoneEntries.map((e) => getZoneName(e.zoneId))}
                    nextRun={nextCronRun(program.scheduleCron)}
                    onRun={handleRunProgram}
                    running={runningProgramId === program.programId}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default IrrigationQueuePanel;
