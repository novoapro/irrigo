import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AIScheduleConfig, AISchedulePreferences, IrrigationSettings, PreferredTimeWindow, ScheduleEntry, ScheduleRun, WaterSavingMode, Zone } from "../types";
import {
  fetchIrrigationSettings,
  updateIrrigationSettings,
  fetchAIScheduleConfig,
  updateAIScheduleConfig,
  triggerAIScheduleRun,
  fetchScheduleRuns,
  fetchScheduleRun
} from "../api";
import { HOUR_OPTIONS } from "../utils/date";
import PreferredTimeWindowsEditor from "./PreferredTimeWindowsEditor";
import AIInteractionModal from "./AIInteractionModal";
import Dropdown from "./Dropdown";
import ActionButton, { CheckIcon, PlayIcon, ErrorCircleIcon } from "./ActionButton";
import { useActionStatus } from "../hooks/useActionStatus";

// ── Option constants ──

const WATER_SAVING_OPTIONS = [
  { value: "normal", label: "Normal — use default durations" },
  { value: "moderate", label: "Moderate — reduce ~25%" },
  { value: "aggressive", label: "Aggressive — reduce ~50%" },
];

const RAIN_PAUSE_OPTIONS = [
  { value: "0", label: "Disabled" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "24 hours" },
  { value: "48", label: "48 hours (default)" },
  { value: "72", label: "72 hours" },
  { value: "96", label: "96 hours" },
  { value: "120", label: "120 hours (5 days)" },
  { value: "168", label: "168 hours (7 days)" },
];

const PROVIDER_OPTIONS = [
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "google", label: "Google Gemini" },
];

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
  { value: "96", label: "96 hours (4 days)" },
  { value: "120", label: "120 hours (5 days)" },
  { value: "168", label: "168 hours (1 week)" },
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

const MAX_DAILY_OPTIONS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
  { value: "120", label: "2 hours" },
  { value: "150", label: "2.5 hours" },
  { value: "180", label: "3 hours" },
  { value: "240", label: "4 hours" },
  { value: "360", label: "6 hours" },
];

const MIN_REST_OPTIONS = [
  { value: "0", label: "No minimum" },
  { value: "1", label: "1 day" },
  { value: "2", label: "2 days" },
  { value: "3", label: "3 days" },
  { value: "4", label: "4 days" },
  { value: "5", label: "5 days" },
  { value: "7", label: "1 week" },
];

const DAYS_OF_WEEK = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

type ScheduleFrequency = "daily" | "every2" | "every3" | "weekdays" | "weekly";

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
      const days = selectedDays.length > 0 ? selectedDays.sort((a, b) => a - b).join(",") : "1,2,3,4,5";
      return `0 ${hour} * * ${days}`;
    }
    case "weekly": return `0 ${hour} * * ${selectedDays[0] ?? 1}`;
    default: return `0 ${hour} * * *`;
  }
};

const formatRunDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
};

const DEFAULT_PREFS: AISchedulePreferences = {
  conservativeWatering: true,
  rainThresholdPercent: 40,
  maxDailyRunMinutes: 120,
  minDaysBetweenRuns: 1
};

// ── Component ──

interface IrrigationSettingsTabProps {
  zones: Zone[];
  onScheduleChanged: () => void;
  aiRunRefreshKey?: number;
}

type LastRunData = { run: ScheduleRun; entries: ScheduleEntry[] } | null;

const IrrigationSettingsTab = ({ zones, onScheduleChanged, aiRunRefreshKey }: IrrigationSettingsTabProps) => {
  const settingsQuery = useQuery({
    queryKey: ["irrigationSettingsTab", aiRunRefreshKey],
    queryFn: async () => {
      const [irrig, ai] = await Promise.all([
        fetchIrrigationSettings(),
        fetchAIScheduleConfig(),
      ]);
      return { irrig, ai };
    }
  });

  const lastRunQuery = useQuery({
    queryKey: ["irrigationSettingsTabLastRun", aiRunRefreshKey],
    queryFn: async (): Promise<LastRunData> => {
      const runsResult = await fetchScheduleRuns(1);
      const run = runsResult?.data?.[0];
      if (!run) return null;
      let entries: ScheduleEntry[] = [];
      try {
        const detail = await fetchScheduleRun(run.scheduleRunId);
        entries = Array.isArray(detail.entries) ? detail.entries : [];
      } catch { /* ignore */ }
      return { run, entries };
    }
  });

  const loading = settingsQuery.isLoading || lastRunQuery.isLoading;
  const error = settingsQuery.error ?? lastRunQuery.error;
  const settings = settingsQuery.data;

  return (
    <div className="irrigation-settings-tab">
      <header className="settings-section-header">
        <h3>Irrigation Settings</h3>
      </header>

      {loading || !settings ? (
        <>
          {error && <p className="zone-control-panel__error">{error instanceof Error ? error.message : "Failed to load"}</p>}
          <p className="muted">Loading settings...</p>
        </>
      ) : (
        <IrrigationSettingsForm
          key={`${settings.irrig.updatedAt ?? settings.irrig._id ?? "s"}:${settings.ai?.updatedAt ?? settings.ai?._id ?? "new"}`}
          initialSettings={settings.irrig}
          initialAiConfig={settings.ai}
          lastRun={lastRunQuery.data?.run ?? null}
          lastRunEntries={lastRunQuery.data?.entries ?? []}
          zones={zones}
          onScheduleChanged={onScheduleChanged}
        />
      )}
    </div>
  );
};

interface IrrigationSettingsFormProps {
  initialSettings: IrrigationSettings;
  initialAiConfig: AIScheduleConfig | null;
  lastRun: ScheduleRun | null;
  lastRunEntries: ScheduleEntry[];
  zones: Zone[];
  onScheduleChanged: () => void;
}

const IrrigationSettingsForm = ({
  initialSettings,
  initialAiConfig,
  lastRun,
  lastRunEntries,
  zones,
  onScheduleChanged
}: IrrigationSettingsFormProps) => {
  const [error, setError] = useState<string | null>(null);
  const { status: saveStatus, wrap: wrapSave } = useActionStatus(2000);
  const [dirty, setDirty] = useState(false);

  // Irrigation settings state
  const [timeWindows, setTimeWindows] = useState<PreferredTimeWindow[]>(initialSettings.preferredTimeWindows);
  const [waterSavingMode, setWaterSavingMode] = useState<WaterSavingMode>(initialSettings.waterSavingMode);
  const [rainPauseHours, setRainPauseHours] = useState(initialSettings.rainPauseHours ?? 48);
  const [timezone, setTimezone] = useState(initialSettings.timezone ?? "America/New_York");

  // AI config state
  const initialParsedCron = parseCron(initialAiConfig?.scheduleCron ?? "");
  const [aiEnabled, setAiEnabled] = useState(initialAiConfig?.enabled ?? false);
  const [provider, setProvider] = useState<"anthropic" | "openai" | "google">(initialAiConfig?.provider ?? "anthropic");
  const [model, setModel] = useState(initialAiConfig?.model ?? "claude-sonnet-4-20250514");
  const [apiKey, setApiKey] = useState(initialAiConfig?.apiKey ?? "");
  const [scheduleFrequency, setScheduleFrequency] = useState<ScheduleFrequency>(initialParsedCron.frequency);
  const [selectedDays, setSelectedDays] = useState<number[]>(initialParsedCron.selectedDays);
  const [scheduleHour, setScheduleHour] = useState(initialParsedCron.hour);
  const [evalWindow, setEvalWindow] = useState(initialAiConfig?.evaluationWindowHours ?? 24);
  const [userContext, setUserContext] = useState(initialAiConfig?.userContext ?? "");
  const [prefs, setPrefs] = useState<AISchedulePreferences>(initialAiConfig?.preferences ?? DEFAULT_PREFS);

  // Last run UI state
  const [runExpanded, setRunExpanded] = useState(false);
  const [interactionRun, setInteractionRun] = useState<ScheduleRun | null>(null);
  const [loadingInteraction, setLoadingInteraction] = useState(false);

  const getZoneName = useCallback((zoneId: string) => {
    const z = zones.find((zone) => zone.zoneId === zoneId);
    return z?.name ?? zoneId;
  }, [zones]);

  const updatePref = <K extends keyof AISchedulePreferences>(key: K, value: AISchedulePreferences[K]) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };

  const handleSave = useCallback(async () => {
    setError(null);
    try {
      await wrapSave(async () => {
        const aiPayload: Partial<AIScheduleConfig> = {
          enabled: aiEnabled,
          provider,
          model,
          scheduleCron: buildCron(scheduleFrequency, scheduleHour, selectedDays),
          evaluationWindowHours: evalWindow,
          userContext,
          preferences: prefs
        };
        if (apiKey && !apiKey.includes("••••")) {
          aiPayload.apiKey = apiKey;
        }
        await Promise.all([
          updateIrrigationSettings({ preferredTimeWindows: timeWindows, waterSavingMode, rainPauseHours, timezone }),
          updateAIScheduleConfig(aiPayload),
        ]);
        setDirty(false);
        onScheduleChanged();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }, [timeWindows, waterSavingMode, rainPauseHours, timezone, aiEnabled, provider, model, apiKey, scheduleFrequency, selectedDays, scheduleHour, evalWindow, userContext, prefs, onScheduleChanged, wrapSave]);

  const handleRunNow = useCallback(async () => {
    setError(null);
    try {
      await triggerAIScheduleRun();
      onScheduleChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
      throw err;
    }
  }, [onScheduleChanged]);

  const markDirty = useCallback(() => setDirty(true), []);

  return (
    <>
      <form
        className="settings-form"
        onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
      >
        {error && <p className="zone-control-panel__error">{error}</p>}

        {/* ── Schedule & Timing ── */}

        <fieldset className="form-fieldset">
          <legend>Schedule &amp; Timing</legend>

          <div className="form-group">
            <label>Timezone</label>
            <input
              type="text"
              className="form-input"
              value={timezone}
              onChange={(e) => { setTimezone(e.target.value); markDirty(); }}
              placeholder="America/New_York"
            />
          </div>

          <div className="form-group">
            <label>Preferred Irrigation Times</label>
            <span className="form-hint">
              Time windows when irrigation is allowed. Programs will only run within these windows.
            </span>
            <PreferredTimeWindowsEditor
              windows={timeWindows}
              onChange={(w) => { setTimeWindows(w); markDirty(); }}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>AI Evaluation Frequency</label>
              <Dropdown
                value={scheduleFrequency}
                options={FREQUENCY_OPTIONS}
                onChange={(v) => { setScheduleFrequency(v as ScheduleFrequency); markDirty(); }}
              />
            </div>
            <div className="form-group">
              <label>Time of Day</label>
              <Dropdown
                value={String(scheduleHour)}
                options={HOUR_OPTIONS}
                onChange={(v) => { setScheduleHour(parseInt(v, 10)); markDirty(); }}
              />
            </div>
          </div>

          {(scheduleFrequency === "weekdays" || scheduleFrequency === "weekly") && (
            <div className="weekday-picker">
              {DAYS_OF_WEEK.map((day) => {
                const active = selectedDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    className={`weekday-picker__day${active ? " weekday-picker__day--active" : ""}`}
                    onClick={() => {
                      setSelectedDays((prev) =>
                        scheduleFrequency === "weekly"
                          ? [day.value]
                          : active ? prev.filter((d) => d !== day.value) : [...prev, day.value]
                      );
                      markDirty();
                    }}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          )}

          <div className="form-group">
            <label>Planning Window</label>
            <Dropdown
              value={String(evalWindow)}
              options={EVAL_WINDOW_OPTIONS}
              onChange={(v) => { setEvalWindow(parseInt(v, 10)); markDirty(); }}
            />
            <span className="form-hint">How far ahead (and back) the AI looks when evaluating.</span>
          </div>
        </fieldset>

        {/* ── Rain & Weather ── */}

        <fieldset className="form-fieldset">
          <legend>Rain &amp; Weather</legend>

          <div className="form-group">
            <label>Rain Pause</label>
            <Dropdown
              value={String(rainPauseHours)}
              options={RAIN_PAUSE_OPTIONS}
              onChange={(v) => { setRainPauseHours(Number(v)); markDirty(); }}
            />
            <span className="form-hint">Wait this long after rain or soil saturation before irrigating again.</span>
          </div>

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
            <label>Rain Probability Threshold</label>
            <Dropdown
              value={String(prefs.rainThresholdPercent)}
              options={RAIN_THRESHOLD_OPTIONS}
              onChange={(v) => updatePref("rainThresholdPercent", parseInt(v, 10))}
            />
            <span className="form-hint">Skip irrigation when the chance of rain exceeds this.</span>
          </div>

        </fieldset>

        {/* ── Water Usage ── */}

        <fieldset className="form-fieldset">
          <legend>Water Usage</legend>

          <div className="form-group">
            <label>Water Saving Mode</label>
            <Dropdown
              value={waterSavingMode}
              options={WATER_SAVING_OPTIONS}
              onChange={(v) => { setWaterSavingMode(v as WaterSavingMode); markDirty(); }}
            />
            <span className="form-hint">Reduces zone durations for all scheduled and AI-planned irrigation.</span>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Max Total per Day</label>
              <Dropdown
                value={String(prefs.maxDailyRunMinutes)}
                options={MAX_DAILY_OPTIONS}
                onChange={(v) => updatePref("maxDailyRunMinutes", parseInt(v, 10))}
              />
            </div>
            <div className="form-group">
              <label>Min Rest Between Runs</label>
              <Dropdown
                value={String(prefs.minDaysBetweenRuns)}
                options={MIN_REST_OPTIONS}
                onChange={(v) => updatePref("minDaysBetweenRuns", parseInt(v, 10))}
              />
            </div>
          </div>
        </fieldset>

        {/* ── AI Provider ── */}

        <fieldset className="form-fieldset">
          <legend>AI Provider</legend>

          <div className="zone-form-top-row">
            <span className="ai-schedule-enable-label">AI Scheduling</span>
            <label
              className={`toggle-switch${aiEnabled ? " toggle-switch--on" : ""}`}
              role="switch"
              aria-checked={aiEnabled}
              aria-label="Enable AI scheduling"
            >
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => { setAiEnabled(e.target.checked); markDirty(); }}
              />
              <span className="toggle-switch__track">
                <span className="toggle-switch__thumb" />
              </span>
            </label>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Provider</label>
              <Dropdown
                value={provider}
                options={PROVIDER_OPTIONS}
                onChange={(v) => { setProvider(v as "anthropic" | "openai" | "google"); markDirty(); }}
              />
            </div>
            <div className="form-group">
              <label>Model</label>
              <input
                type="text"
                value={model}
                placeholder={provider === "anthropic" ? "claude-sonnet-4-20250514" : provider === "google" ? "gemini-2.5-flash" : "gpt-4o"}
                onChange={(e) => { setModel(e.target.value); markDirty(); }}
              />
            </div>
          </div>
          <div className="form-group">
            <label>API Key</label>
            <input
              type="password"
              value={apiKey}
              placeholder="sk-..."
              onChange={(e) => { setApiKey(e.target.value); markDirty(); }}
            />
          </div>
        </fieldset>

        {/* ── Additional Context ── */}

        <fieldset className="form-fieldset">
          <legend>Additional Context</legend>
          <span className="form-hint">Tell the AI anything else it should know — yard details, plant needs, seasonal notes.</span>
          <div className="form-group">
            <textarea
              className="form-textarea"
              value={userContext}
              placeholder="e.g. 'The front lawn is newly seeded and needs more frequent, lighter watering.'"
              rows={4}
              maxLength={2000}
              onChange={(e) => { setUserContext(e.target.value); markDirty(); }}
            />
            <span className="form-hint">{userContext.length} / 2000</span>
          </div>
        </fieldset>

        {/* ── Last AI Run ── */}

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
                    <p className="muted">No zones scheduled.</p>
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

        {/* ── Actions ── */}

        <div className="form-actions">
          {aiEnabled && (
            <ActionButton
              icon={lastRun?.status === "error" ? <ErrorCircleIcon /> : <PlayIcon />}
              variant="ghost"
              idleClassName={`ai-run-status-btn ai-run-status-btn--${lastRun?.status === "completed" ? "success" : lastRun?.status ?? "none"}`}
              action={handleRunNow}
              successLabel="Done"
              errorLabel="Failed"
              title={lastRun ? `Last: ${formatRunDate(lastRun.startedAt)} (${lastRun.status})` : "Run AI Now"}
              aria-label="Run AI Now"
            />
          )}
          {dirty && (
            <ActionButton
              icon={<CheckIcon />}
              variant="primary"
              type="submit"
              status={saveStatus}
              successLabel="Saved"
              errorLabel="Error"
              title="Save Settings"
              aria-label="Save settings"
            />
          )}
        </div>
      </form>

      {interactionRun && (
        <AIInteractionModal run={interactionRun} onClose={() => setInteractionRun(null)} />
      )}
    </>
  );
};

export default IrrigationSettingsTab;
