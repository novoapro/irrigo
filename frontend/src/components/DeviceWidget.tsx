import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DeviceConfig } from "../types";

interface DeviceWidgetProps {
  ip?: string;
  tempF?: number;
  humidity?: number;
  baselinePsi?: number;
  lastHeartbeat: string;
  deviceConfig: DeviceConfig | null;
  isDeviceConfigLoading: boolean;
  onSaveConfig: (config: DeviceConfig) => Promise<void>;
}

const DeviceWidget = ({
  ip,
  tempF,
  humidity,
  baselinePsi,
  lastHeartbeat,
  deviceConfig,
  isDeviceConfigLoading,
  onSaveConfig
}: DeviceWidgetProps) => {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [draftConfig, setDraftConfig] = useState<DeviceConfig | null>(deviceConfig);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraftConfig(deviceConfig);
  }, [deviceConfig]);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!draftConfig) {
      return;
    }
    try {
      setIsSaving(true);
      await onSaveConfig(draftConfig);
      setIsSettingsOpen(false);
    } catch (error) {
      console.error("Failed to update device config:", error);
    } finally {
      setIsSaving(false);
    }
  }, [draftConfig, onSaveConfig]);

  return (
    <article className="device-widget">
      <header className="device-header">
        <div className="device-meta">
          <div className="device-icon">🛠️</div>
          <div>
            <h3>IoT Device</h3>
            <p className="muted">Enclosure status snapshot</p>
          </div>
        </div>
        <div className="device-tags">
          <span className="device-tag">
            <span className="device-tag-label">IP</span>
            <span className="device-tag-value">{ip ?? deviceConfig?.deviceIp ?? "—"}</span>
          </span>
        </div>
      </header>
      <dl className="device-stat-grid">
        <div className="device-stat-card">
          <dt>Last heartbeat</dt>
          <dd>{lastHeartbeat}</dd>
        </div>
        {baselinePsi !== undefined ? (
          <div className="device-stat-card">
            <dt>Baseline PSI</dt>
            <dd>{baselinePsi.toFixed(1)}</dd>
          </div>
        ) : null}
        <div className="device-stat-card">
          <dt>Temperature</dt>
          <dd>
            {tempF !== undefined ? `${tempF.toFixed(1)} °F` : "—"}
          </dd>
        </div>
        <div className="device-stat-card">
          <dt>Humidity</dt>
          <dd>
            {humidity !== undefined ? `${humidity.toFixed(1)} %` : "—"}
          </dd>
        </div>
      </dl>
      <footer className="device-footer">
        <button
          type="button"
          className="ghost-button device-settings-button"
          onClick={handleOpenSettings}
          disabled={!isDeviceConfigLoading && !deviceConfig}
        >
          {isDeviceConfigLoading ? "Loading..." : "Device Settings"}
        </button>
      </footer>

      {isSettingsOpen
        ? createPortal(
          <div className="modal-overlay" role="dialog" aria-modal="true">
            <div className="modal-content">
              <header className="modal-header">
                <h2>Device Settings</h2>
              </header>

              <div className="modal-body">
                {isDeviceConfigLoading || !draftConfig ? (
                  <p className="loading-text">Loading device settings...</p>
                ) : (
                  <form
                    className="settings-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSubmit();
                    }}
                  >
                    <div className="form-group">
                      <label>
                        <span>Baseline PSI</span>
                        <input
                          type="number"
                          step="0.1"
                          value={draftConfig.baselineDefault ?? baselinePsi ?? 0}
                          onChange={(e) => setDraftConfig((prev) => prev ? {
                            ...prev,
                            baselineDefault: parseFloat(e.target.value)
                          } : prev)}
                        />
                      </label>
                    </div>

                    <div className="form-group">
                      <label>
                        <span>Sample Interval (ms)</span>
                        <input
                          type="number"
                          step="1000"
                          min="1000"
                          value={draftConfig.sampleIntervalMs ?? 30000}
                          onChange={(e) => setDraftConfig((prev) => prev ? {
                            ...prev,
                            sampleIntervalMs: parseInt(e.target.value, 10)
                          } : prev)}
                        />
                      </label>
                    </div>

                    <div className="form-group">
                      <label>
                        <span>Heartbeat Interval (ms)</span>
                        <input
                          type="number"
                          step="1000"
                          min="1000"
                          value={draftConfig.heartbeatIntervalMs ?? 300000}
                          onChange={(e) => setDraftConfig((prev) => prev ? {
                            ...prev,
                            heartbeatIntervalMs: parseInt(e.target.value, 10)
                          } : prev)}
                        />
                      </label>
                    </div>

                    <div className="form-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={draftConfig.guardEnabled ?? true}
                          onChange={(e) => setDraftConfig((prev) => prev ? {
                            ...prev,
                            guardEnabled: e.target.checked
                          } : prev)}
                        />
                        <span>Activate Guard</span>
                      </label>
                    </div>

                    <div className="form-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={draftConfig.rainEnabled ?? true}
                          onChange={(e) => setDraftConfig((prev) => prev ? {
                            ...prev,
                            rainEnabled: e.target.checked
                          } : prev)}
                        />
                        <span>Activate Rain Sensor</span>
                      </label>
                    </div>

                    <div className="form-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={draftConfig.moistEnabled ?? true}
                          onChange={(e) => setDraftConfig((prev) => prev ? {
                            ...prev,
                            moistEnabled: e.target.checked
                          } : prev)}
                        />
                        <span>Activate Moisture Sensor</span>
                      </label>
                    </div>
                    <div className="form-group">
                      <label>
                        <span>PSI Spike Threshold</span>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={draftConfig.psiSpikeDelta ?? 10.0}
                          onChange={(e) => setDraftConfig((prev) => prev ? {
                            ...prev,
                            psiSpikeDelta: parseFloat(e.target.value)
                          } : prev)}
                        />
                      </label>
                    </div>

                    <div className="form-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setIsSettingsOpen(false);
                          setDraftConfig(deviceConfig);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="primary-button"
                        disabled={isSaving || isDeviceConfigLoading}
                      >
                        Save Changes
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>,
          document.body
        )
        : null}
    </article>
  );
};

export default DeviceWidget;
