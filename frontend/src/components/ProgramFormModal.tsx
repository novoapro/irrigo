import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { IrrigationProgram, ProgramZoneEntry, Zone } from "../types";
import { createProgram, updateProgram } from "../api";
import Dropdown from "./Dropdown";

type ScheduleFrequency = "daily" | "every2" | "every3" | "weekly" | "weekdays";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${i.toString().padStart(2, "0")}:00`
}));

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Every day" },
  { value: "every2", label: "Every 2 days" },
  { value: "every3", label: "Every 3 days" },
  { value: "weekly", label: "Once a week" },
  { value: "weekdays", label: "Weekdays" }
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

const DURATION_OPTIONS = [
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  { value: "15", label: "15 min" },
  { value: "20", label: "20 min" },
  { value: "30", label: "30 min" },
  { value: "45", label: "45 min" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
  { value: "120", label: "2 hours" }
];

const parseCron = (cron: string): { frequency: ScheduleFrequency; hour: number; selectedDays: number[] } => {
  const parts = cron.trim().split(/\s+/);
  const hour = parseInt(parts[1] ?? "6", 10) || 6;
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
    case "weekly": return `0 ${hour} * * 1`;
    case "weekdays": {
      const days = selectedDays.length > 0 ? selectedDays.sort((a, b) => a - b).join(",") : "1";
      return `0 ${hour} * * ${days}`;
    }
    default: return `0 ${hour} * * *`;
  }
};

interface ProgramFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  zones: Zone[];
  program?: IrrigationProgram | null;
}

const ProgramFormModal = ({ open, onClose, onSaved, zones, program }: ProgramFormModalProps) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [frequency, setFrequency] = useState<ScheduleFrequency>("daily");
  const [hour, setHour] = useState(6);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 3, 5]);
  const [zoneEntries, setZoneEntries] = useState<Record<string, { included: boolean; duration: number }>>({});
  const [deferralEnabled, setDeferralEnabled] = useState(false);
  const [deferralWindowMinutes, setDeferralWindowMinutes] = useState(120);

  useEffect(() => {
    if (!open) return;
    if (program) {
      setName(program.name);
      setEnabled(program.enabled);
      setDeferralEnabled(program.deferralEnabled ?? false);
      setDeferralWindowMinutes(program.deferralWindowMinutes ?? 120);
      const parsed = parseCron(program.scheduleCron);
      setFrequency(parsed.frequency);
      setHour(parsed.hour);
      if (parsed.selectedDays.length > 0) setSelectedDays(parsed.selectedDays);
      const entries: Record<string, { included: boolean; duration: number }> = {};
      for (const zone of zones) {
        const existing = program.zoneEntries.find((e) => e.zoneId === zone.zoneId);
        entries[zone.zoneId] = {
          included: !!existing,
          duration: existing?.durationMinutes ?? zone.defaultDurationMinutes
        };
      }
      setZoneEntries(entries);
    } else {
      setName("");
      setEnabled(true);
      setDeferralEnabled(false);
      setDeferralWindowMinutes(120);
      setFrequency("daily");
      setHour(6);
      setSelectedDays([1, 3, 5]);
      const entries: Record<string, { included: boolean; duration: number }> = {};
      for (const zone of zones) {
        entries[zone.zoneId] = { included: zone.enabled, duration: zone.defaultDurationMinutes };
      }
      setZoneEntries(entries);
    }
    setError(null);
  }, [open, program, zones]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const selectedEntries: ProgramZoneEntry[] = Object.entries(zoneEntries)
        .filter(([, v]) => v.included)
        .map(([zoneId, v]) => ({ zoneId, durationMinutes: v.duration }));

      if (selectedEntries.length === 0) {
        setError("Select at least one zone");
        setSaving(false);
        return;
      }

      const payload = {
        name: name.trim(),
        enabled,
        scheduleCron: buildCron(frequency, hour, selectedDays),
        zoneEntries: selectedEntries,
        deferralEnabled,
        deferralWindowMinutes
      };

      if (program) {
        await updateProgram(program.programId, payload);
      } else {
        await createProgram(payload);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [name, enabled, frequency, hour, selectedDays, zoneEntries, deferralEnabled, deferralWindowMinutes, program, onSaved, onClose]);

  const toggleZone = (zoneId: string) => {
    setZoneEntries((prev) => ({
      ...prev,
      [zoneId]: { ...prev[zoneId]!, included: !prev[zoneId]!.included }
    }));
  };

  const setZoneDuration = (zoneId: string, duration: number) => {
    setZoneEntries((prev) => ({
      ...prev,
      [zoneId]: { ...prev[zoneId]!, duration }
    }));
  };

  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-content modal-content--wide">
        <header className="modal-header">
          <h2>{program ? "Edit Program" : "New Program"}</h2>
        </header>
        <div className="modal-body">
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            {error && <p className="zone-control-panel__error">{error}</p>}

            <div className="form-group">
              <label>Program Name</label>
              <input
                type="text"
                value={name}
                placeholder="e.g. Summer Evening"
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="zone-form-top-row">
              <span className="ai-schedule-enable-label">Enabled</span>
              <label
                className={`toggle-switch${enabled ? " toggle-switch--on" : ""}`}
                role="switch"
                aria-checked={enabled}
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

            <div className="zone-form-top-row">
              <span className="ai-schedule-enable-label">Defer on Guard</span>
              <label
                className={`toggle-switch${deferralEnabled ? " toggle-switch--on" : ""}`}
                role="switch"
                aria-checked={deferralEnabled}
              >
                <input
                  type="checkbox"
                  checked={deferralEnabled}
                  onChange={(e) => setDeferralEnabled(e.target.checked)}
                />
                <span className="toggle-switch__track">
                  <span className="toggle-switch__thumb" />
                </span>
              </label>
            </div>
            {deferralEnabled && (
              <div className="form-group">
                <label>Deferral Window (minutes)</label>
                <input
                  type="number"
                  min={15}
                  max={480}
                  value={deferralWindowMinutes}
                  onChange={(e) => setDeferralWindowMinutes(Math.max(15, Math.min(480, parseInt(e.target.value, 10) || 120)))}
                />
                <span className="form-hint">How long to wait for the guard to clear before giving up.</span>
              </div>
            )}

            <fieldset className="form-fieldset">
              <legend>Schedule</legend>
              <div className="form-row">
                <div className="form-group">
                  <label>Frequency</label>
                  <Dropdown
                    value={frequency}
                    options={FREQUENCY_OPTIONS}
                    onChange={(v) => setFrequency(v as ScheduleFrequency)}
                  />
                </div>
                <div className="form-group">
                  <label>Time</label>
                  <Dropdown
                    value={String(hour)}
                    options={HOUR_OPTIONS}
                    onChange={(v) => setHour(parseInt(v, 10))}
                  />
                </div>
              </div>
              {frequency === "weekdays" && (
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
            </fieldset>

            <fieldset className="form-fieldset">
              <legend>Zones</legend>
              <span className="form-hint">Select which zones to include and set their duration.</span>
              <div className="program-zone-list">
                {zones.map((zone) => {
                  const entry = zoneEntries[zone.zoneId];
                  if (!entry) return null;
                  return (
                    <div className={`program-zone-row${entry.included ? "" : " program-zone-row--disabled"}`} key={zone.zoneId}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={entry.included}
                          onChange={() => toggleZone(zone.zoneId)}
                        />
                        <span>{zone.name}</span>
                      </label>
                      {entry.included && (
                        <Dropdown
                          value={String(entry.duration)}
                          options={DURATION_OPTIONS}
                          onChange={(v) => setZoneDuration(zone.zoneId, parseInt(v, 10))}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <div className="form-actions">
              <button type="button" className="ghost-button icon-btn danger-text" onClick={onClose} title="Cancel" aria-label="Cancel">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
              <button type="submit" className="primary-button icon-btn" disabled={saving || !name.trim()} title={saving ? "Saving..." : "Save"} aria-label={saving ? "Saving..." : "Save"}>
                {saving ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ProgramFormModal;
