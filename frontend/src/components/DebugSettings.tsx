import { useCallback, useEffect, useState } from "react";
import type { Zone } from "../types";
import {
  fetchDebugConfig,
  updateDebugConfig,
  simulateCharacteristic
} from "../api";
import ActionButton, { useActionStatus, CheckIcon } from "./ActionButton";
import Dropdown from "./Dropdown";

type CharacteristicKey = "active" | "inUse" | "isConfigured" | "setDuration" | "remainingDuration";

const CHARACTERISTICS: { value: CharacteristicKey; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inUse", label: "In Use" },
  { value: "isConfigured", label: "Is Configured" },
  { value: "setDuration", label: "Set Duration" },
  { value: "remainingDuration", label: "Remaining Duration" },
];

const BOOLEAN_VALUES = [
  { value: "1", label: "1 (On)" },
  { value: "0", label: "0 (Off)" },
];

const IS_CONFIGURED_VALUES = [
  { value: "1", label: "1 (Enabled)" },
  { value: "0", label: "0 (Disabled)" },
];

const DURATION_VALUES = [
  { value: "0", label: "0s" },
  { value: "30", label: "30s" },
  { value: "60", label: "1 min" },
  { value: "300", label: "5 min" },
  { value: "600", label: "10 min" },
  { value: "900", label: "15 min" },
  { value: "1800", label: "30 min" },
  { value: "3600", label: "60 min" },
];

const getValueOptions = (characteristic: CharacteristicKey) => {
  switch (characteristic) {
    case "active":
    case "inUse":
      return BOOLEAN_VALUES;
    case "isConfigured":
      return IS_CONFIGURED_VALUES;
    case "setDuration":
    case "remainingDuration":
      return DURATION_VALUES;
  }
};

const getDefaultValue = (characteristic: CharacteristicKey) => {
  switch (characteristic) {
    case "active":
    case "inUse":
    case "isConfigured":
      return "1";
    case "setDuration":
    case "remainingDuration":
      return "300";
  }
};

interface DebugSettingsProps {
  zones: Zone[];
  onDebugModeChanged?: (enabled: boolean) => void;
}

const DebugSettings = ({ zones, onDebugModeChanged }: DebugSettingsProps) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { status: saveStatus, wrap: wrapSave } = useActionStatus();

  const [enabled, setEnabled] = useState(false);

  const [simZoneId, setSimZoneId] = useState("");
  const [simCharacteristic, setSimCharacteristic] = useState<CharacteristicKey>("active");
  const [simValue, setSimValue] = useState("1");
  const [simResult, setSimResult] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchDebugConfig()
      .then((c) => {
        if (!cancelled) setEnabled(c?.enabled ?? false);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (zones.length > 0 && !simZoneId) {
      setSimZoneId(zones[0].zoneId);
    }
  }, [zones, simZoneId]);

  const handleCharacteristicChange = useCallback((key: string) => {
    const k = key as CharacteristicKey;
    setSimCharacteristic(k);
    setSimValue(getDefaultValue(k));
  }, []);

  const handleSave = useCallback(async () => {
    setError(null);
    await wrapSave(async () => {
      await updateDebugConfig({ enabled });
      onDebugModeChanged?.(enabled);
    });
  }, [enabled, wrapSave, onDebugModeChanged]);

  const handleSimulate = useCallback(async () => {
    setSimResult(null);
    try {
      const result = await simulateCharacteristic({
        zoneId: simZoneId,
        characteristic: simCharacteristic,
        value: Number(simValue)
      });
      const zoneName = result.zoneName ?? simZoneId;
      const charLabel = CHARACTERISTICS.find((c) => c.value === result.characteristic)?.label ?? result.characteristic;
      setSimResult(`${zoneName} — ${charLabel}: ${result.action}`);
    } catch (err) {
      setSimResult(err instanceof Error ? err.message : "Failed");
    }
  }, [simZoneId, simCharacteristic, simValue]);

  if (loading) return <p className="debug-settings__loading">Loading debug config...</p>;

  return (
    <div className="debug-settings">
      <h3>Debug Mode</h3>

      <div className="debug-settings__warning">
        When enabled, CompAI commands are mocked — no real commands are sent to external devices.
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <div className="zone-form-top-row">
          <span className="ai-schedule-enable-label">Debug Mode</span>
          <label
            className={`toggle-switch${enabled ? " toggle-switch--on" : ""}`}
            role="switch"
            aria-checked={enabled}
            aria-label="Enable debug mode"
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

        {error && <p className="debug-settings__error">{error}</p>}

        <div className="debug-settings__actions">
          <ActionButton
            icon={<CheckIcon />}
            type="submit"
            status={saveStatus}
            successLabel="Saved"
            errorLabel="Failed"
            title="Save debug configuration"
          />
        </div>
      </form>

      {enabled && zones.length > 0 && (
        <div className="debug-settings__simulate">
          <h4>Simulate Characteristic</h4>
          <p className="debug-settings__hint">
            Send a characteristic value change — triggers the same flow as a real CompAI webhook.
          </p>
          <div className="debug-settings__row">
            <div className="form-group">
              <label>Zone</label>
              <Dropdown
                value={simZoneId}
                options={zones.map((z) => ({ value: z.zoneId, label: z.name }))}
                onChange={setSimZoneId}
              />
            </div>
            <div className="form-group">
              <label>Characteristic</label>
              <Dropdown
                value={simCharacteristic}
                options={CHARACTERISTICS}
                onChange={handleCharacteristicChange}
              />
            </div>
          </div>
          <div className="debug-settings__row">
            <div className="form-group">
              <label>Value</label>
              <Dropdown
                value={simValue}
                options={getValueOptions(simCharacteristic)}
                onChange={setSimValue}
              />
            </div>
            <button
              type="button"
              className="icon-btn primary-button"
              style={{ alignSelf: "flex-end" }}
              onClick={() => void handleSimulate()}
            >
              Send
            </button>
          </div>
          {simResult && (
            <p className="debug-settings__sim-result">{simResult}</p>
          )}
        </div>
      )}
    </div>
  );
};

export default DebugSettings;
