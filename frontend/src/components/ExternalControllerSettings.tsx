import { useCallback, useEffect, useState } from "react";
import type { ExternalControllerConfig, Zone } from "../types";
import {
  fetchExternalControllerConfig,
  updateExternalControllerConfig,
  testExternalController
} from "../api";
import Dropdown from "./Dropdown";

const AUTH_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer Token" },
  { value: "apikey", label: "API Key" },
  { value: "basic", label: "Basic Auth" },
];

interface ExternalControllerSettingsProps {
  zones: Zone[];
}

const ExternalControllerSettings = ({ zones }: ExternalControllerSettingsProps) => {
  const [collapsed, setCollapsed] = useState(true);
  const [config, setConfig] = useState<ExternalControllerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "apikey" | "basic">("none");
  const [authToken, setAuthToken] = useState("");
  const [commandPath, setCommandPath] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [enabled, setEnabled] = useState(true);
  const [zoneMapping, setZoneMapping] = useState<Record<string, string>>({});

  const populateForm = useCallback((c: ExternalControllerConfig | null) => {
    setName(c?.name ?? "");
    setEndpoint(c?.endpoint ?? "");
    setAuthType(c?.authType ?? "none");
    setAuthToken(c?.authToken ?? "");
    setCommandPath(c?.commandPath ?? "");
    setTimeoutMs(c?.timeoutMs ?? 10000);
    setEnabled(c?.enabled ?? true);
    setZoneMapping(c?.zoneMapping ?? {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchExternalControllerConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        populateForm(c);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [populateForm]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: Partial<ExternalControllerConfig> = {
        name,
        endpoint,
        authType,
        commandPath: commandPath || undefined,
        timeoutMs,
        enabled,
        zoneMapping
      };
      if (authToken && !authToken.includes("••••")) {
        payload.authToken = authToken;
      }
      const result = await updateExternalControllerConfig(payload);
      setConfig(result);
      populateForm(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [name, endpoint, authType, authToken, commandPath, timeoutMs, enabled, zoneMapping, populateForm]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testExternalController();
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }, []);

  const handleMappingChange = useCallback((zoneId: string, value: string) => {
    setZoneMapping((prev) => {
      const next = { ...prev };
      if (value) {
        next[zoneId] = value;
      } else {
        delete next[zoneId];
      }
      return next;
    });
  }, []);

  if (loading) {
    return <p className="muted">Loading controller config...</p>;
  }

  return (
    <div className="external-controller-settings external-controller-settings--collapsible">
      <button
        type="button"
        className="external-controller-settings__toggle"
        onClick={() => setCollapsed((p) => !p)}
        aria-expanded={!collapsed}
      >
        <h3>External Controller</h3>
        <span className="form-hint" style={{ marginLeft: "auto", marginTop: 0 }}>Legacy</span>
        <svg
          className={`compai-zone-item__chevron${!collapsed ? " compai-zone-item__chevron--open" : ""}`}
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {!collapsed && <>
      {error && <p className="zone-control-panel__error">{error}</p>}

      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        <div className="zone-form-top-row">
          <span className="ai-schedule-enable-label">Enabled</span>
          <label
            className={`toggle-switch${enabled ? " toggle-switch--on" : ""}`}
            role="switch"
            aria-checked={enabled}
            aria-label="Enable controller"
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

        <div className="form-group">
          <label>Name</label>
          <input
            type="text"
            value={name}
            placeholder="My Controller"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Endpoint URL</label>
          <input
            type="url"
            value={endpoint}
            placeholder="http://192.168.1.100:8080"
            onChange={(e) => setEndpoint(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Command Path Template</label>
          <input
            type="text"
            value={commandPath}
            placeholder="/cm?sid={{zoneId}}&en={{action}}&t={{duration}}"
            onChange={(e) => setCommandPath(e.target.value)}
          />
          <span className="form-hint">
            {"{{zoneId}}"} &middot; {"{{action}}"} (1/0) &middot; {"{{duration}}"} (minutes)
          </span>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Auth Type</label>
            <Dropdown
              value={authType}
              options={AUTH_OPTIONS}
              onChange={(v) => setAuthType(v as typeof authType)}
            />
          </div>
          <div className="form-group">
            <label>Timeout (ms)</label>
            <input
              type="number"
              min="1000"
              step="1000"
              value={timeoutMs}
              onChange={(e) => setTimeoutMs(parseInt(e.target.value, 10) || 10000)}
            />
          </div>
        </div>

        {authType !== "none" && (
          <div className="form-group">
            <label>Auth Token / Credentials</label>
            <input
              type="password"
              value={authToken}
              placeholder="Token or credentials"
              onChange={(e) => setAuthToken(e.target.value)}
            />
          </div>
        )}

        {zones.length > 0 && (
          <fieldset className="form-fieldset">
            <legend>Zone Mapping</legend>
            <p className="form-hint">
              Map each zone to its external controller ID. Leave blank to use the zone ID as-is.
            </p>
            {zones.map((z) => (
              <div className="form-group" key={z.zoneId}>
                <label>{z.name} <span className="form-hint" style={{ display: "inline" }}>({z.zoneId})</span></label>
                <input
                  type="text"
                  value={zoneMapping[z.zoneId] ?? ""}
                  placeholder={z.zoneId}
                  onChange={(e) => handleMappingChange(z.zoneId, e.target.value)}
                />
              </div>
            ))}
          </fieldset>
        )}

        {testResult && (
          <div
            className={`controller-test-result ${testResult.success ? "controller-test-result--ok" : "controller-test-result--fail"}`}
          >
            {testResult.success ? "Connected" : "Failed"}: {testResult.message}
          </div>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="ghost-button icon-btn"
            onClick={handleTest}
            disabled={testing || !endpoint}
            aria-label={testing ? "Testing..." : "Test connection"}
            title={testing ? "Testing..." : "Test connection"}
          >
            {testing
              ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            }
          </button>
          <div className="form-actions-right">
            <button
              type="submit"
              className="primary-button icon-btn"
              disabled={saving || !endpoint}
              aria-label={saving ? "Saving..." : "Save"}
              title={saving ? "Saving..." : "Save"}
            >
              {saving
                ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              }
            </button>
          </div>
        </div>
      </form>
      </>}
    </div>
  );
};

export default ExternalControllerSettings;
