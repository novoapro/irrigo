import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  const { data: config, isLoading } = useQuery({
    queryKey: ["debugConfig"],
    queryFn: async () => (await fetchDebugConfig()) ?? null
  });

  if (isLoading) return <p className="debug-settings__loading">Loading debug config...</p>;

  return (
    <DebugSettingsForm
      key={config?.updatedAt ?? config?._id ?? "new"}
      initialEnabled={config?.enabled ?? false}
      zones={zones}
      onDebugModeChanged={onDebugModeChanged}
    />
  );
};

interface DebugSettingsFormProps {
  initialEnabled: boolean;
  zones: Zone[];
  onDebugModeChanged?: (enabled: boolean) => void;
}

const DebugSettingsForm = ({ initialEnabled, zones, onDebugModeChanged }: DebugSettingsFormProps) => {
  const [error, setError] = useState<string | null>(null);
  const { status: saveStatus, wrap: wrapSave } = useActionStatus();

  const [enabled, setEnabled] = useState(initialEnabled);

  const [simZoneId, setSimZoneId] = useState("");
  const [simCharacteristic, setSimCharacteristic] = useState<CharacteristicKey>("active");
  const [simValue, setSimValue] = useState("1");
  const [simResult, setSimResult] = useState<string | null>(null);

  // Default the simulate zone to the first available zone without a
  // prop→state sync effect.
  const effectiveSimZoneId = simZoneId || zones[0]?.zoneId || "";

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
        zoneId: effectiveSimZoneId,
        characteristic: simCharacteristic,
        value: Number(simValue)
      });
      const zoneName = result.zoneName ?? effectiveSimZoneId;
      const charLabel = CHARACTERISTICS.find((c) => c.value === result.characteristic)?.label ?? result.characteristic;
      setSimResult(`${zoneName} — ${charLabel}: ${result.action}`);
    } catch (err) {
      setSimResult(err instanceof Error ? err.message : "Failed");
    }
  }, [effectiveSimZoneId, simCharacteristic, simValue]);

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
                value={effectiveSimZoneId}
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
