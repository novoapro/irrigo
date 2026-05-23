import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AIScheduleConfig, AISchedulePreferences, ScheduleEntry, ScheduleRun, Zone } from "../types";
import { fetchAIScheduleConfig, updateAIScheduleConfig, triggerAIScheduleRun, fetchScheduleRuns, fetchScheduleRun } from "../api";
import Dropdown from "./Dropdown";
import AIInteractionModal from "./AIInteractionModal";
import ActionButton, { useActionStatus, CheckIcon, XIcon, PlayIcon, ErrorCircleIcon } from "./ActionButton";

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropics" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google Gemini" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${i.toString().padStart(2, "0")}:00`,
}));

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Every day" },
  { value: "every2", label: "Every 2 days" },
  { value: "every3", label: "Every 3 days" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Once a week" },
];

const EVAL_WINDOW_OPTIONS = [
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
  { value: "48", label: "48 hours" },
  { value: "72", label: "72 hours" },
  { value: "168", label: "1 week" },
];

const RAIN_THRESHOLD_OPTIONS = [
  { value: "20", label: "20% — water unless rain is very likely" },
  { value: "30", label: "30%" },
  { value: "40", label: "40% — balanced (default)" },
  { value: "50", label: "50%" },
  { value: "60", label: "60%" },
  { value: "70", label: "70%" },
  { value: "80", label: "80% — only skip if rain is almost certain" },
];

const RAIN_LOOKBACK_OPTIONS = [
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
  { value: "48", label: "48 hours (default)" },
  { value: "72", label: "72 hours" },
];

const MAX_DAILY_OPTIONS = [
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
  { value: "120", label: "2 hours" },
  { value: "180", label: "3 hours" },
  { value: "240", label: "4 hours" },
];

const MIN_DAYS_OPTIONS = [
  { value: "0", label: "No minimum" },
  { value: "1", label: "1 day" },
  { value: "2", label: "2 days" },
  { value: "3", label: "3 days" },
];

type ScheduleFrequency = "daily" | "every2" | "every3" | "weekdays" | "weekly";

const DAYS_OF_WEEK = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

const parseCron = (cron: string): { frequency: ScheduleFrequency; hour: number; selectedDays: number[] } => {
  const parts = cron.trim().split(/\s+/);
  const hour = parseInt(parts[1] ?? "4", 10) || 4;

  const dayOfMonth = parts[2] ?? "*";
  const dayOfWeek = parts[4] ?? "*";

  if (dayOfWeek !== "*") {
    const days = dayOfWeek.split(",").map(Number).filter((n) => !isNaN(n));
    if (days.length === 1) return { frequency: "weekly", hour, selectedDays: days };
    return { frequency: "weekdays", hour, selectedDays: days };
  }
  if (dayOfMonth === "*/3") return { frequency: "every3", hour, selectedDays: [] };
  if (dayOfMonth === "*/2") return { frequency: "every2", hour, selectedDays: [] };
  return { frequency: "daily", hour, selectedDays: [] };
};

const buildCron = (frequency: ScheduleFrequency, hour: number, selectedDays: number[]): string => {
  switch (frequency) {
    case "every2": return `0 ${hour} */2 * *`;
    case "every3": return `0 ${hour} */3 * *`;
    case "weekdays": {
      const days = selectedDays.length > 0 ? selectedDays.sort((a, b) => a - b).join(",") : "1-5";
      return `0 ${hour} * * ${days}`;
    }
    case "weekly": return `0 ${hour} * * 1`;
    default: return `0 ${hour} * * *`;
  }
};

interface AIScheduleConfigModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  inline?: boolean;
  zones?: Zone[];
  refreshKey?: number;
}

const DEFAULT_PREFS: AISchedulePreferences = {
  conservativeWatering: true,
  rainThresholdPercent: 40,
  recentRainWindowHours: 48,
  maxDailyRunMinutes: 120,
  minDaysBetweenRuns: 1
};

const formatRunDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
};

const AIScheduleConfigModal = ({ open, onClose, onSaved, inline = false, zones = [], refreshKey }: AIScheduleConfigModalProps) => {
  const [loading, setLoading] = useState(true);
  const { status: saveStatus, wrap: wrapSave } = useActionStatus(2000, inline ? undefined : onClose);
  const [error, setError] = useState<string | null>(null);

  const [lastRun, setLastRun] = useState<ScheduleRun | null>(null);
  const [lastRunEntries, setLastRunEntries] = useState<ScheduleEntry[]>([]);
  const [runExpanded, setRunExpanded] = useState(false);
  const [interactionRun, setInteractionRun] = useState<ScheduleRun | null>(null);
  const [loadingInteraction, setLoadingInteraction] = useState(false);

  const getZoneName = useCallback((zoneId: string) => {
    const z = zones.find((zone) => zone.zoneId === zoneId);
    return z?.name ?? zoneId;
  }, [zones]);

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<"anthropic" | "openai" | "google">("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [apiKey, setApiKey] = useState("");
  const [scheduleFrequency, setScheduleFrequency] = useState<ScheduleFrequency>("daily");
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [scheduleHour, setScheduleHour] = useState(4);
  const [evalWindow, setEvalWindow] = useState(24);
  const [userContext, setUserContext] = useState("");
  const [prefs, setPrefs] = useState<AISchedulePreferences>(DEFAULT_PREFS);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchAIScheduleConfig(),
      fetchScheduleRuns(1),
    ])
      .then(async ([c, runsResult]) => {
        if (cancelled) return;
        if (c) {
          setEnabled(c.enabled);
          setProvider(c.provider);
          setModel(c.model);
          setApiKey(c.apiKey ?? "");
          const parsed = parseCron(c.scheduleCron);
          setScheduleFrequency(parsed.frequency);
          setSelectedDays(parsed.selectedDays);
          setScheduleHour(parsed.hour);
          setEvalWindow(c.evaluationWindowHours);
          setUserContext(c.userContext);
          setPrefs(c.preferences ?? DEFAULT_PREFS);
        }
        const runs = runsResult?.data;
        if (runs && runs.length > 0) {
          const run = runs[0]!;
          setLastRun(run);
          try {
            const detail = await fetchScheduleRun(run.scheduleRunId);
            if (!cancelled) {
              setLastRunEntries(Array.isArray(detail.entries) ? detail.entries : []);
            }
          } catch { /* ignore */ }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, refreshKey]);

  const handleSave = useCallback(async () => {
    setError(null);
    try {
      await wrapSave(async () => {
        const payload: Partial<AIScheduleConfig> = {
          enabled,
          provider,
          model,
          scheduleCron: buildCron(scheduleFrequency, scheduleHour, selectedDays),
          evaluationWindowHours: evalWindow,
          userContext,
          preferences: prefs
        };
        if (apiKey && !apiKey.includes("••••")) {
          payload.apiKey = apiKey;
        }
        await updateAIScheduleConfig(payload);
        onSaved();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }, [enabled, provider, model, apiKey, scheduleFrequency, selectedDays, scheduleHour, evalWindow, userContext, prefs, onSaved, wrapSave]);

  const handleRunNow = useCallback(async () => {
    setError(null);
    try {
      await triggerAIScheduleRun();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
      throw err;
    }
  }, [onSaved]);

  const updatePref = <K extends keyof AISchedulePreferences>(key: K, value: AISchedulePreferences[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  };

  if (!open) return null;

  const formContent = (
    <>
      {inline && (
        <header className="settings-section-header">
          <h3>Smart Schedule</h3>
        </header>
      )}
      {loading ? (
        <p className="muted">Loading configuration...</p>
      ) : (
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          {error && <p className="zone-control-panel__error">{error}</p>}

          <div className="zone-form-top-row">
            <span className="ai-schedule-enable-label">AI Scheduling</span>
            <label
              className={`toggle-switch${enabled ? " toggle-switch--on" : ""}`}
              role="switch"
              aria-checked={enabled}
              aria-label="Enable AI scheduling"
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span className="toggle-switch__track">
                <span className="toggle-switch__thumb" />
              </span>
            </label>
          </div>

          <fieldset className="form-fieldset">
            <legend>AI Provider</legend>
            <div className="form-row">
              <div className="form-group">
                <label>Provider</label>
                <Dropdown
                  value={provider}
                  options={PROVIDER_OPTIONS}
                  onChange={(v) => setProvider(v as "anthropic" | "openai" | "google")}
                />
              </div>
              <div className="form-group">
                <label>Model</label>
                <input
                  type="text"
                  value={model}
                  placeholder={provider === "anthropic" ? "claude-sonnet-4-20250514" : provider === "google" ? "gemini-2.5-flash" : "gpt-4o"}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
            </div>
            <div className="form-group">
              <label>API Key</label>
              <input
                type="password"
                value={apiKey}
                placeholder="sk-..."
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend>Evaluation Schedule</legend>
            <span className="form-hint">How often and when the AI reviews conditions and plans irrigation.</span>
            <div className="form-row">
              <div className="form-group">
                <label>Frequency</label>
                <Dropdown
                  value={scheduleFrequency}
                  options={FREQUENCY_OPTIONS}
                  onChange={(v) => setScheduleFrequency(v as ScheduleFrequency)}
                />
              </div>
              <div className="form-group">
                <label>Time of day</label>
                <Dropdown
                  value={String(scheduleHour)}
                  options={HOUR_OPTIONS}
                  onChange={(v) => setScheduleHour(parseInt(v, 10))}
                />
              </div>
            </div>
            {scheduleFrequency === "weekdays" && (
              <div className="weekday-picker">
                {DAYS_OF_WEEK.map((day) => {
                  const active = selectedDays.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      className={`weekday-picker__day${active ? " weekday-picker__day--active" : ""}`}
                      onClick={() =>
                        setSelectedDays((prev) =>
                          active ? prev.filter((d) => d !== day.value) : [...prev, day.value]
                        )
                      }
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="form-group">
              <label>Planning window</label>
              <Dropdown
                value={String(evalWindow)}
                options={EVAL_WINDOW_OPTIONS}
                onChange={(v) => setEvalWindow(parseInt(v, 10))}
              />
              <span className="form-hint">How far ahead the AI plans when it evaluates.</span>
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend>Rain &amp; Weather Sensitivity</legend>
            <span className="form-hint">Controls how the AI responds to rain forecasts and recent weather.</span>
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={prefs.conservativeWatering}
                  onChange={(e) => updatePref("conservativeWatering", e.target.checked)}
                />
                <span>Skip watering if rain is expected</span>
              </label>
            </div>
            <div className="form-group">
              <label>Rain probability threshold</label>
              <Dropdown
                value={String(prefs.rainThresholdPercent)}
                options={RAIN_THRESHOLD_OPTIONS}
                onChange={(v) => updatePref("rainThresholdPercent", parseInt(v, 10))}
              />
              <span className="form-hint">Skip irrigation when the chance of rain exceeds this.</span>
            </div>
            <div className="form-group">
              <label>Recent rain lookback</label>
              <Dropdown
                value={String(prefs.recentRainWindowHours)}
                options={RAIN_LOOKBACK_OPTIONS}
                onChange={(v) => updatePref("recentRainWindowHours", parseInt(v, 10))}
              />
              <span className="form-hint">How far back to check for recent rain before scheduling.</span>
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend>Watering Limits</legend>
            <span className="form-hint">Guardrails for how much and how often the AI can schedule irrigation.</span>
            <div className="form-row">
              <div className="form-group">
                <label>Max total per day</label>
                <Dropdown
                  value={String(prefs.maxDailyRunMinutes)}
                  options={MAX_DAILY_OPTIONS}
                  onChange={(v) => updatePref("maxDailyRunMinutes", parseInt(v, 10))}
                />
              </div>
              <div className="form-group">
                <label>Min rest between runs</label>
                <Dropdown
                  value={String(prefs.minDaysBetweenRuns)}
                  options={MIN_DAYS_OPTIONS}
                  onChange={(v) => updatePref("minDaysBetweenRuns", parseInt(v, 10))}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend>Additional Context</legend>
            <span className="form-hint">Tell the AI anything else it should know — yard details, plant needs, seasonal notes, or special instructions.</span>
            <div className="form-group">
              <textarea
                className="form-textarea"
                value={userContext}
                placeholder="e.g. 'The front lawn is newly seeded and needs more frequent, lighter watering. The backyard has mature grass that is drought-tolerant. We have clay soil that retains moisture.'"
                rows={4}
                maxLength={2000}
                onChange={(e) => setUserContext(e.target.value)}
              />
              <span className="form-hint">{userContext.length} / 2000</span>
            </div>
          </fieldset>

          {lastRun && (
            <fieldset className="form-fieldset">
              <legend>Last AI Run</legend>
              <div className={`schedule-run${runExpanded ? " schedule-run--expanded" : ""}`}>
                <button
                  type="button"
                  className="schedule-run__header"
                  onClick={() => setRunExpanded((v) => !v)}
                >
                  <span className={`schedule-run__chevron${runExpanded ? " schedule-run__chevron--open" : ""}`}>
                    <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor">
                      <path d="M6.293 7.293a1 1 0 011.414 0L10 9.586l2.293-2.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" />
                    </svg>
                  </span>
                  <span className={`schedule-status-pill schedule-status-pill--${lastRun.status}`}>
                    {lastRun.status}
                  </span>
                  <span className="schedule-run__time">{formatRunDate(lastRun.startedAt)}</span>
                  <span className="schedule-run__meta muted">
                    {lastRun.triggeredBy === "cron" ? "auto" : "manual"}
                    {typeof lastRun.entries === "number" && lastRun.entries > 0 ? ` · ${lastRun.entries} zone${lastRun.entries !== 1 ? "s" : ""}` : ""}
                  </span>
                </button>
                {runExpanded && (
                  <div className="schedule-run__body">
                    {lastRun.reasoning && (
                      <p className="schedule-run__reasoning">{lastRun.reasoning}</p>
                    )}
                    {lastRunEntries.length > 0 ? (
                      <div className="queue-card__zones">
                        {lastRunEntries.map((entry) => (
                          <div className="queue-card__zone-row" key={entry._id}>
                            <span className="queue-card__zone-name">{getZoneName(entry.zoneId)}</span>
                            <span className="queue-card__zone-dur">{entry.plannedDurationMinutes} min</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">No zones scheduled — conditions not favorable.</p>
                    )}
                    <button
                      type="button"
                      className="ghost-button schedule-run__view-interaction"
                      disabled={loadingInteraction}
                      onClick={async () => {
                        if (!lastRun) return;
                        setLoadingInteraction(true);
                        try {
                          const detail = await fetchScheduleRun(lastRun.scheduleRunId);
                          setInteractionRun(detail);
                        } catch (err) {
                          console.error("Failed to load interaction:", err);
                        } finally {
                          setLoadingInteraction(false);
                        }
                      }}
                    >
                      {loadingInteraction ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                      )}
                      View Interaction
                    </button>
                  </div>
                )}
              </div>
            </fieldset>
          )}

          <div className="form-actions">
            {!inline && (
              <ActionButton
                icon={<XIcon />}
                variant="ghost"
                onClick={onClose}
                title="Cancel"
                aria-label="Cancel"
              />
            )}
            {enabled && (
              <ActionButton
                icon={lastRun?.status === "error" ? <ErrorCircleIcon /> : <PlayIcon />}
                variant="ghost"
                idleClassName={`ai-run-status-btn ai-run-status-btn--${lastRun?.status === "completed" ? "success" : lastRun?.status ?? "none"}`}
                action={handleRunNow}
                successLabel="Done"
                errorLabel="Failed"
                title={lastRun ? `Last: ${formatRunDate(lastRun.startedAt)} (${lastRun.status})` : "Run AI Run"}
                aria-label="Run AI Run"
              />
            )}
            <ActionButton
              icon={<CheckIcon />}
              variant="primary"
              type="submit"
              status={saveStatus}
              successLabel="Saved"
              errorLabel="Error"
              title="Save"
              aria-label="Save"
            />
          </div>
        </form>
      )}
    </>
  );

  const interactionModal = interactionRun ? (
    <AIInteractionModal run={interactionRun} onClose={() => setInteractionRun(null)} />
  ) : null;

  if (inline) return <>{formContent}{interactionModal}</>;

  return (
    <>
      {createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-content modal-content--wide">
            <header className="modal-header">
              <h2>AI Scheduling Configuration</h2>
            </header>
            <div className="modal-body">{formContent}</div>
          </div>
        </div>,
        document.body
      )}
      {interactionModal}
    </>
  );
};

export default AIScheduleConfigModal;
