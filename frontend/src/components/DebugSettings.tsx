import { useCallback, useEffect, useState } from "react";
import type { Zone } from "../types";
import {
  fetchDebugConfig,
  updateDebugConfig,
  simulateDebugEvent
} from "../api";
import ActionButton, { useActionStatus, CheckIcon } from "./ActionButton";
import Dropdown from "./Dropdown";

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
  const [simAction, setSimAction] = useState<"on" | "off">("on");
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

  const handleSave = useCallback(async () => {
    setError(null);
    await wrapSave(async () => {
      await updateDebugConfig({ enabled });
      onDebugModeChanged?.(enabled);
    });
  }, [enabled, wrapSave, onDebugModeChanged]);

  const handleSimulateEvent = useCallback(async () => {
    setSimResult(null);
    try {
      const result = await simulateDebugEvent({ zoneId: simZoneId, action: simAction });
      const zoneName = result.zoneName ?? simZoneId;
      setSimResult(`${zoneName}: ${result.action}`);
    } catch (err) {
      setSimResult(err instanceof Error ? err.message : "Failed");
    }
  }, [simZoneId, simAction]);

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
          <h4>Simulate Zone Event</h4>
          <p className="debug-settings__hint">
            Simulate a CompAI webhook — triggers the same flow as a real device event.
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
              <label>Action</label>
              <Dropdown
                value={simAction}
                options={[
                  { value: "on", label: "Turn On" },
                  { value: "off", label: "Turn Off" }
                ]}
                onChange={(v) => setSimAction(v as "on" | "off")}
              />
            </div>
            <button
              type="button"
              className="icon-btn primary-button"
              style={{ alignSelf: "flex-end" }}
              onClick={() => void handleSimulateEvent()}
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
