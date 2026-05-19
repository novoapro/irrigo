import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { AIScheduleConfig, AISchedulePreferences } from "../types";
import { fetchAIScheduleConfig, updateAIScheduleConfig, triggerAIScheduleRun } from "../api";
import Dropdown from "./Dropdown";

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropics" },
  { value: "openai", label: "OpenAI" },
];

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${i.toString().padStart(2, "0")}:00`,
}));

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Every day" },
  { value: "every2", label: "Every 2 days" },
  { value: "every3", label: "Every 3 days" },
  { value: "weekly", label: "Once a week" },
];

const EVAL_WINDOW_OPTIONS = [
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
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

type ScheduleFrequency = "daily" | "every2" | "every3" | "weekly";

const parseCron = (cron: string): { frequency: ScheduleFrequency; hour: number } => {
  const parts = cron.trim().split(/\s+/);
  const hour = parseInt(parts[1] ?? "4", 10) || 4;

  const dayOfMonth = parts[2] ?? "*";
  const dayOfWeek = parts[4] ?? "*";

  if (dayOfWeek !== "*") return { frequency: "weekly", hour };
  if (dayOfMonth === "*/3") return { frequency: "every3", hour };
  if (dayOfMonth === "*/2") return { frequency: "every2", hour };
  return { frequency: "daily", hour };
};

const buildCron = (frequency: ScheduleFrequency, hour: number): string => {
  switch (frequency) {
    case "every2": return `0 ${hour} */2 * *`;
    case "every3": return `0 ${hour} */3 * *`;
    case "weekly": return `0 ${hour} * * 1`;
    default: return `0 ${hour} * * *`;
  }
};

interface AIScheduleConfigModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  inline?: boolean;
}

const DEFAULT_PREFS: AISchedulePreferences = {
  conservativeWatering: true,
  rainThresholdPercent: 40,
  recentRainWindowHours: 48,
  preferredTimeWindows: [{ startHour: 20, endHour: 6 }],
  maxDailyRunMinutes: 120,
  minDaysBetweenRuns: 1
};

const AIScheduleConfigModal = ({ open, onClose, onSaved, inline = false }: AIScheduleConfigModalProps) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [model, setModel] = useState("claude-sonnet-4-20250514");
  const [apiKey, setApiKey] = useState("");
  const [scheduleFrequency, setScheduleFrequency] = useState<ScheduleFrequency>("daily");
  const [scheduleHour, setScheduleHour] = useState(4);
  const [evalWindow, setEvalWindow] = useState(24);
  const [userContext, setUserContext] = useState("");
  const [prefs, setPrefs] = useState<AISchedulePreferences>(DEFAULT_PREFS);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAIScheduleConfig()
      .then((c) => {
        if (cancelled) return;
        if (c) {
          setEnabled(c.enabled);
          setProvider(c.provider);
          setModel(c.model);
          setApiKey(c.apiKey ?? "");
          const parsed = parseCron(c.scheduleCron);
          setScheduleFrequency(parsed.frequency);
          setScheduleHour(parsed.hour);
          setEvalWindow(c.evaluationWindowHours);
          setUserContext(c.userContext);
          setPrefs(c.preferences ?? DEFAULT_PREFS);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<AIScheduleConfig> = {
        enabled,
        provider,
        model,
        scheduleCron: buildCron(scheduleFrequency, scheduleHour),
        evaluationWindowHours: evalWindow,
        userContext,
        preferences: prefs
      };
      if (apiKey && !apiKey.includes("••••")) {
        payload.apiKey = apiKey;
      }
      await updateAIScheduleConfig(payload);
      onSaved();
      if (!inline) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [enabled, provider, model, apiKey, scheduleFrequency, scheduleHour, evalWindow, userContext, prefs, onSaved, onClose, inline]);

  const handleRunNow = useCallback(async () => {
    setRunningNow(true);
    setRunResult(null);
    setError(null);
    try {
      const result = await triggerAIScheduleRun();
      setRunResult(`Created ${result.entriesCreated} schedule entries.`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunningNow(false);
    }
  }, [onSaved]);

  const updatePref = <K extends keyof AISchedulePreferences>(key: K, value: AISchedulePreferences[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  };

  const updateTimeWindow = (index: number, field: "startHour" | "endHour", value: number) => {
    setPrefs((p) => {
      const windows = [...p.preferredTimeWindows];
      windows[index] = { ...windows[index], [field]: value };
      return { ...p, preferredTimeWindows: windows };
    });
  };

  const addTimeWindow = () => {
    setPrefs((p) => ({
      ...p,
      preferredTimeWindows: [...p.preferredTimeWindows, { startHour: 20, endHour: 6 }]
    }));
  };

  const removeTimeWindow = (index: number) => {
    setPrefs((p) => ({
      ...p,
      preferredTimeWindows: p.preferredTimeWindows.filter((_, i) => i !== index)
    }));
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

          {enabled && (
            <div className="ai-schedule-run-now">
              <button
                type="button"
                className="primary-button icon-btn"
                onClick={() => void handleRunNow()}
                disabled={runningNow}
                title={runningNow ? "Running..." : "Run AI scheduler now"}
                aria-label={runningNow ? "Running AI scheduler" : "Run AI scheduler now"}
              >
                {runningNow ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                )}
              </button>
              <span className="ai-schedule-run-now__label">
                {runningNow ? "Evaluating..." : "Force run evaluation"}
              </span>
              {runResult && <span className="ai-schedule-run-now__result muted">{runResult}</span>}
            </div>
          )}

          <fieldset className="form-fieldset">
            <legend>AI Provider</legend>
            <div className="form-row">
              <div className="form-group">
                <label>Provider</label>
                <Dropdown
                  value={provider}
                  options={PROVIDER_OPTIONS}
                  onChange={(v) => setProvider(v as "anthropic" | "openai")}
                />
              </div>
              <div className="form-group">
                <label>Model</label>
                <input
                  type="text"
                  value={model}
                  placeholder={provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o"}
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
            <legend>Preferred Irrigation Times</legend>
            <span className="form-hint">The AI will try to schedule watering within these windows.</span>
            {prefs.preferredTimeWindows.map((w, i) => (
              <div className="time-window-row" key={i}>
                <div className="form-group time-window-field">
                  <label>From</label>
                  <Dropdown
                    value={String(w.startHour)}
                    options={HOUR_OPTIONS}
                    onChange={(v) => updateTimeWindow(i, "startHour", parseInt(v, 10))}
                  />
                </div>
                <div className="form-group time-window-field">
                  <label>To</label>
                  <Dropdown
                    value={String(w.endHour)}
                    options={HOUR_OPTIONS}
                    onChange={(v) => updateTimeWindow(i, "endHour", parseInt(v, 10))}
                  />
                </div>
                {prefs.preferredTimeWindows.length > 1 && (
                  <button
                    type="button"
                    className="ghost-button icon-btn danger-text time-window-remove"
                    onClick={() => removeTimeWindow(i)}
                    aria-label="Remove window"
                    title="Remove window"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="ghost-button time-window-add" onClick={addTimeWindow}>
              + Add Window
            </button>
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

          <div className="form-actions">
            {!inline && (
              <button type="button" className="ghost-button icon-btn danger-text" onClick={onClose} title="Cancel" aria-label="Cancel">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            )}
            <button type="submit" className="primary-button icon-btn" disabled={saving} title={saving ? "Saving..." : "Save"} aria-label={saving ? "Saving..." : "Save"}>
              {saving ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              )}
            </button>
          </div>
        </form>
      )}
    </>
  );

  if (inline) return formContent;

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-content modal-content--wide">
        <header className="modal-header">
          <h2>AI Scheduling Configuration</h2>
        </header>
        <div className="modal-body">{formContent}</div>
      </div>
    </div>,
    document.body
  );
};

export default AIScheduleConfigModal;
