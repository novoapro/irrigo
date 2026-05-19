import { useCallback, useEffect, useRef, useState } from "react";
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

const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5z" /></svg>
);

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
  const [draft, setDraft] = useState<DeviceConfig | null>(deviceConfig);
  const [isSaving, setIsSaving] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(deviceConfig);
  }, [deviceConfig]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    try {
      setIsSaving(true);
      await onSaveConfig(draft);
    } catch (error) {
      console.error("Failed to save device config:", error);
    } finally {
      setIsSaving(false);
    }
  }, [draft, onSaveConfig]);

  const startEditingIdentity = useCallback(() => {
    setDraftName(draft?.deviceName ?? "");
    setDraftDesc(draft?.deviceDescription ?? "");
    setEditingIdentity(true);
    setTimeout(() => nameInputRef.current?.focus(), 0);
  }, [draft]);

  const cancelEditingIdentity = useCallback(() => {
    setEditingIdentity(false);
  }, []);

  const saveIdentity = useCallback(async () => {
    if (!draft) return;
    const updated = { ...draft, deviceName: draftName || undefined, deviceDescription: draftDesc || undefined };
    setDraft(updated);
    setEditingIdentity(false);
    try {
      setIsSaving(true);
      await onSaveConfig(updated);
    } catch (error) {
      console.error("Failed to save device identity:", error);
    } finally {
      setIsSaving(false);
    }
  }, [draft, draftName, draftDesc, onSaveConfig]);

  const deviceIp = ip ?? deviceConfig?.deviceIp ?? "—";

  if (isDeviceConfigLoading || !draft) {
    return (
      <article className="device-widget">
        <p className="muted">Loading device...</p>
      </article>
    );
  }

  return (
    <article className="device-widget">
      <header className="device-header">
        <div className="device-header__top">
          {editingIdentity ? (
            <div className="device-identity-edit">
              <div className="device-identity-edit__row">
                <input
                  ref={nameInputRef}
                  type="text"
                  className="device-name-input"
                  value={draftName}
                  placeholder="Device name"
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void saveIdentity(); if (e.key === "Escape") cancelEditingIdentity(); }}
                />
              </div>
              <input
                type="text"
                className="device-desc-input"
                value={draftDesc}
                placeholder="Description"
                onChange={(e) => setDraftDesc(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void saveIdentity(); if (e.key === "Escape") cancelEditingIdentity(); }}
              />
              <div className="device-identity-edit__actions">
                <button type="button" className="icon-btn primary-button" onClick={() => void saveIdentity()} title="Save" aria-label="Save">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </button>
                <button type="button" className="icon-btn ghost-button danger-text" onClick={cancelEditingIdentity} title="Cancel" aria-label="Cancel">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            </div>
          ) : (
            <div className="device-identity">
              <div className="device-identity__name-row">
                <h3 className="device-identity__name">{draft.deviceName || "Unnamed Device"}</h3>
                <button type="button" className="icon-btn ghost-button device-identity__edit" onClick={startEditingIdentity} title="Edit name & description" aria-label="Edit name & description">
                  <PencilIcon />
                </button>
              </div>
              {draft.deviceDescription && (
                <p className="device-identity__desc">{draft.deviceDescription}</p>
              )}
            </div>
          )}
        </div>
        <div className="device-stats-bar">
          <div className="device-stats-bar__left">
            <span className="device-reading" title="Temperature">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z" /></svg>
              {tempF !== undefined ? `${tempF.toFixed(1)}°F` : "—"}
            </span>
            <span className="device-reading" title="Humidity">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" /></svg>
              {humidity !== undefined ? `${humidity.toFixed(1)}%` : "—"}
            </span>
          </div>
          <div className="device-stats-bar__right">
            <span className="device-ip">{deviceIp}</span>
            <span className="device-heartbeat muted" title="Last heartbeat">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              {lastHeartbeat}
            </span>
          </div>
        </div>
      </header>

      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <fieldset className="form-fieldset">
          <legend>Sensors &amp; Thresholds</legend>
          <div className="form-group">
            <label>
              <span>Baseline PSI</span>
              <input
                type="number"
                step="0.1"
                value={draft.baselineDefault ?? baselinePsi ?? 0}
                onChange={(e) => setDraft((p) => p ? { ...p, baselineDefault: parseFloat(e.target.value) } : p)}
              />
            </label>
          </div>
          <div className="form-group">
            <label>
              <span>PSI Spike Threshold</span>
              <input
                type="number"
                step="0.1"
                min="0"
                value={draft.psiSpikeDelta ?? 10.0}
                onChange={(e) => setDraft((p) => p ? { ...p, psiSpikeDelta: parseFloat(e.target.value) } : p)}
              />
            </label>
          </div>
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.guardEnabled ?? true}
                onChange={(e) => setDraft((p) => p ? { ...p, guardEnabled: e.target.checked } : p)}
              />
              <span>Activate Guard</span>
            </label>
          </div>
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.rainEnabled ?? true}
                onChange={(e) => setDraft((p) => p ? { ...p, rainEnabled: e.target.checked } : p)}
              />
              <span>Rain Sensor</span>
            </label>
          </div>
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.moistEnabled ?? true}
                onChange={(e) => setDraft((p) => p ? { ...p, moistEnabled: e.target.checked } : p)}
              />
              <span>Moisture Sensor</span>
            </label>
          </div>
        </fieldset>

        <fieldset className="form-fieldset">
          <legend>Timing</legend>
          <div className="form-group">
            <label>
              <span>Sample Interval (ms)</span>
              <input
                type="number"
                step="1000"
                min="1000"
                value={draft.sampleIntervalMs ?? 30000}
                onChange={(e) => setDraft((p) => p ? { ...p, sampleIntervalMs: parseInt(e.target.value, 10) } : p)}
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
                value={draft.heartbeatIntervalMs ?? 300000}
                onChange={(e) => setDraft((p) => p ? { ...p, heartbeatIntervalMs: parseInt(e.target.value, 10) } : p)}
              />
            </label>
          </div>
        </fieldset>

        <div className="form-actions">
          <button
            type="submit"
            className="primary-button icon-btn"
            disabled={isSaving}
            title={isSaving ? "Saving..." : "Save changes"}
            aria-label={isSaving ? "Saving..." : "Save changes"}
          >
            {isSaving ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            )}
          </button>
        </div>
      </form>
    </article>
  );
};

export default DeviceWidget;
