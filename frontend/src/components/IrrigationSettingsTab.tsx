import { useState, useEffect, useCallback } from "react";
import type { IrrigationSettings, PreferredTimeWindow, WaterSavingMode, Zone } from "../types";
import { fetchIrrigationSettings, updateIrrigationSettings } from "../api";
import PreferredTimeWindowsEditor from "./PreferredTimeWindowsEditor";
import AIScheduleConfigModal from "./AIScheduleConfigModal";
import Dropdown from "./Dropdown";
import ActionButton, { useActionStatus, CheckIcon } from "./ActionButton";

const WATER_SAVING_OPTIONS = [
  { value: "normal", label: "Normal — use default durations" },
  { value: "moderate", label: "Moderate — reduce ~25%" },
  { value: "aggressive", label: "Aggressive — reduce ~50%" },
];

interface IrrigationSettingsTabProps {
  zones: Zone[];
  onScheduleChanged: () => void;
  aiRunRefreshKey?: number;
}

const IrrigationSettingsTab = ({ zones, onScheduleChanged, aiRunRefreshKey }: IrrigationSettingsTabProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { status: saveStatus, wrap: wrapSave } = useActionStatus(2000);

  const [timeWindows, setTimeWindows] = useState<PreferredTimeWindow[]>([{ startHour: 20, endHour: 6 }]);
  const [waterSavingMode, setWaterSavingMode] = useState<WaterSavingMode>("normal");
  const [timezone, setTimezone] = useState("America/New_York");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchIrrigationSettings()
      .then((settings) => {
        if (cancelled) return;
        setTimeWindows(settings.preferredTimeWindows);
        setWaterSavingMode(settings.waterSavingMode);
        setTimezone(settings.timezone ?? "America/New_York");
        setDirty(false);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleWindowsChange = useCallback((windows: PreferredTimeWindow[]) => {
    setTimeWindows(windows);
    setDirty(true);
  }, []);

  const handleWaterSavingChange = useCallback((mode: WaterSavingMode) => {
    setWaterSavingMode(mode);
    setDirty(true);
  }, []);

  const handleSaveCommon = useCallback(async () => {
    setError(null);
    try {
      await wrapSave(async () => {
        await updateIrrigationSettings({
          preferredTimeWindows: timeWindows,
          waterSavingMode,
          timezone
        });
        setDirty(false);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }, [timeWindows, waterSavingMode, timezone, wrapSave]);

  return (
    <div className="irrigation-settings-tab">
      <header className="settings-section-header">
        <h3>Irrigation</h3>
      </header>

      {loading ? (
        <p className="muted">Loading settings...</p>
      ) : (
        <>
          {error && <p className="zone-control-panel__error">{error}</p>}

          <fieldset className="form-fieldset">
            <legend>Timezone</legend>
            <span className="form-hint">
              IANA timezone used for scheduling. All irrigation times are interpreted in this timezone.
            </span>
            <div className="form-group">
              <input
                type="text"
                className="form-input"
                value={timezone}
                onChange={(e) => { setTimezone(e.target.value); setDirty(true); }}
                placeholder="America/New_York"
              />
            </div>
          </fieldset>

          <fieldset className="form-fieldset">
            <legend>Preferred Irrigation Times</legend>
            <span className="form-hint">
              Time windows when irrigation is allowed. Deferred programs will only resume within these windows.
            </span>
            <PreferredTimeWindowsEditor
              windows={timeWindows}
              onChange={handleWindowsChange}
            />
          </fieldset>

          <fieldset className="form-fieldset">
            <legend>Water Saving</legend>
            <span className="form-hint">
              Reduces zone durations for both scheduled programs and AI-planned irrigation.
            </span>
            <div className="form-group">
              <Dropdown
                value={waterSavingMode}
                options={WATER_SAVING_OPTIONS}
                onChange={(v) => handleWaterSavingChange(v as WaterSavingMode)}
              />
            </div>
          </fieldset>

          {dirty && (
            <div className="form-actions form-actions--inline">
              <ActionButton
                icon={<CheckIcon />}
                variant="primary"
                action={handleSaveCommon}
                status={saveStatus}
                successLabel="Saved"
                errorLabel="Error"
                title="Save Settings"
                aria-label="Save irrigation settings"
              />
            </div>
          )}

          <AIScheduleConfigModal
            open={true}
            inline={true}
            onClose={() => {}}
            onSaved={onScheduleChanged}
            zones={zones}
            refreshKey={aiRunRefreshKey}
          />
        </>
      )}
    </div>
  );
};

export default IrrigationSettingsTab;
