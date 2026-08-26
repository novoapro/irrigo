import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import type { IrrigationProgram, ProgramZoneEntry, Zone } from "../types";
import { createProgram, updateProgram } from "../api";
import Dropdown from "./Dropdown";
import ActionButton, { useActionStatus, CheckIcon, XIcon } from "./ActionButton";

type ScheduleFrequency = "daily" | "every2" | "every3" | "weekly" | "weekdays";

const minutesToTimeValue = (totalMinutes: number): string => {
  const clamped = Math.max(0, Math.min(1439, totalMinutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
};

const timeValueToMinutes = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = parseInt(match[1]!, 10);
  const m = parseInt(match[2]!, 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

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

const parseCron = (cron: string): { frequency: ScheduleFrequency; timeMinutes: number; selectedDays: number[] } => {
  const parts = cron.trim().split(/\s+/);
  const minute = parseInt(parts[0] ?? "0", 10) || 0;
  const hour = parseInt(parts[1] ?? "6", 10) || 6;
  const timeMinutes = hour * 60 + minute;
  const dayOfMonth = parts[2] ?? "*";
  const dayOfWeek = parts[4] ?? "*";

  if (dayOfWeek !== "*") {
    const days = dayOfWeek.split(",").map(Number).filter((n) => !isNaN(n));
    if (days.length === 1) return { frequency: "weekly", timeMinutes, selectedDays: days };
    return { frequency: "weekdays", timeMinutes, selectedDays: days };
  }
  if (dayOfMonth === "*/3") return { frequency: "every3", timeMinutes, selectedDays: [] };
  if (dayOfMonth === "*/2") return { frequency: "every2", timeMinutes, selectedDays: [] };
  return { frequency: "daily", timeMinutes, selectedDays: [] };
};

const buildCron = (frequency: ScheduleFrequency, timeMinutes: number, selectedDays: number[]): string => {
  const h = Math.floor(timeMinutes / 60);
  const m = timeMinutes % 60;
  switch (frequency) {
    case "every2": return `${m} ${h} */2 * *`;
    case "every3": return `${m} ${h} */3 * *`;
    case "weekly": return `${m} ${h} * * ${selectedDays[0] ?? 1}`;
    case "weekdays": {
      const days = selectedDays.length > 0 ? selectedDays.sort((a, b) => a - b).join(",") : "1";
      return `${m} ${h} * * ${days}`;
    }
    default: return `${m} ${h} * * *`;
  }
};

interface ProgramFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  zones: Zone[];
  program?: IrrigationProgram | null;
}

type ZoneEntryMap = Record<string, { included: boolean; duration: number }>;

const buildInitialZoneEntries = (
  zones: Zone[],
  program?: IrrigationProgram | null
): ZoneEntryMap => {
  const entries: ZoneEntryMap = {};
  for (const zone of zones) {
    if (program) {
      const existing = program.zoneEntries.find((e) => e.zoneId === zone.zoneId);
      entries[zone.zoneId] = {
        included: !!existing,
        duration: existing?.durationMinutes ?? zone.defaultDurationMinutes
      };
    } else {
      entries[zone.zoneId] = { included: zone.enabled, duration: zone.defaultDurationMinutes };
    }
  }
  return entries;
};

// Body is mounted only while open and keyed by the target program (see the
// wrapper below), so form state initialises from props at mount — no prop-sync
// effect (set-state-in-effect).
const ProgramFormModalBody = ({ onClose, onSaved, zones, program }: Omit<ProgramFormModalProps, "open">) => {
  const { status: saveStatus, wrap: wrapSave } = useActionStatus(2000, onClose);
  const cron = program ? parseCron(program.scheduleCron ?? "0 6 * * *") : null;
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(program?.name ?? "");
  const [enabled, setEnabled] = useState(program?.enabled ?? true);
  const [frequency, setFrequency] = useState<ScheduleFrequency>(cron?.frequency ?? "daily");
  const [timeMinutes, setTimeMinutes] = useState(cron?.timeMinutes ?? 360);
  const [selectedDays, setSelectedDays] = useState<number[]>(
    cron && cron.selectedDays.length > 0 ? cron.selectedDays : [1, 3, 5]
  );
  const [zoneEntries, setZoneEntries] = useState<ZoneEntryMap>(() =>
    buildInitialZoneEntries(zones, program)
  );

  const handleSave = useCallback(async () => {
    setError(null);
    const selectedEntries: ProgramZoneEntry[] = Object.entries(zoneEntries)
      .filter(([, v]) => v.included)
      .map(([zoneId, v]) => ({ zoneId, durationMinutes: v.duration }));

    if (selectedEntries.length === 0) {
      setError("Select at least one zone");
      return;
    }

    if (selectedEntries.some((e) => !Number.isInteger(e.durationMinutes) || e.durationMinutes < 1 || e.durationMinutes > 480)) {
      setError("Each selected zone needs a duration between 1 and 480 minutes");
      return;
    }

    try {
      await wrapSave(async () => {
        const payload = {
          name: name.trim(),
          enabled,
          source: "manual" as const,
          scheduleCron: buildCron(frequency, timeMinutes, selectedDays),
          zoneEntries: selectedEntries
        };

        if (program) {
          await updateProgram(program.programId, payload);
        } else {
          await createProgram(payload);
        }

        onSaved();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }, [name, enabled, frequency, timeMinutes, selectedDays, zoneEntries, program, onSaved, wrapSave]);

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
                  <input
                    type="time"
                    value={minutesToTimeValue(timeMinutes)}
                    onChange={(e) => {
                      const parsed = timeValueToMinutes(e.target.value);
                      if (parsed !== null) setTimeMinutes(parsed);
                    }}
                  />
                </div>
              </div>
              {(frequency === "weekdays" || frequency === "weekly") && (
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
                            frequency === "weekly"
                              ? [day.value]
                              : active ? prev.filter((d) => d !== day.value) : [...prev, day.value]
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
                        <div className="program-zone-row__duration">
                          <input
                            type="number"
                            min={1}
                            max={480}
                            value={entry.duration}
                            onChange={(e) => {
                              const next = parseInt(e.target.value, 10);
                              setZoneDuration(zone.zoneId, Number.isNaN(next) ? 0 : next);
                            }}
                          />
                          <span className="program-zone-row__duration-unit">min</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <div className="form-actions">
              <ActionButton
                icon={<XIcon />}
                variant="ghost"
                onClick={onClose}
                title="Cancel"
                aria-label="Cancel"
              />
              <ActionButton
                icon={<CheckIcon />}
                variant="primary"
                type="submit"
                status={saveStatus}
                successLabel="Saved"
                errorLabel="Error"
                disabled={!name.trim()}
                title="Save"
                aria-label="Save"
              />
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  );
};

// Wrapper: mount the form only while open, keyed by the target program so each
// open (or switching which program is edited) initialises fresh from props.
const ProgramFormModal = ({ open, ...rest }: ProgramFormModalProps) => {
  if (!open) return null;
  return <ProgramFormModalBody key={rest.program?.programId ?? "new"} {...rest} />;
};

export default ProgramFormModal;
