import { useCallback, useEffect, useState } from "react";
import type { CompAIConfig, CompAIDiscoveredService, CompAIZoneConfig, Zone } from "../types";
import {
  fetchCompAIConfig,
  updateCompAIConfig,
  testCompAIConnection,
  discoverCompAIServices,
  updateZone
} from "../api";
import Dropdown from "./Dropdown";

const AUTH_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer Token" },
  { value: "apikey", label: "API Key" },
  { value: "basic", label: "Basic Auth" },
];

interface CompAISettingsProps {
  zones: Zone[];
  onZonesChanged?: () => void;
  onHealthChanged?: () => void;
}

const CompAISettings = ({ zones, onZonesChanged, onHealthChanged }: CompAISettingsProps) => {
  const [config, setConfig] = useState<CompAIConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "apikey" | "basic">("none");
  const [authToken, setAuthToken] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [webhookSecret, setWebhookSecret] = useState("");

  // Discovery
  const [discoveredServices, setDiscoveredServices] = useState<CompAIDiscoveredService[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceReachable, setDeviceReachable] = useState<boolean | null>(null);

  // Zone mapping
  const [savingZone, setSavingZone] = useState<string | null>(null);
  const [zoneError, setZoneError] = useState<string | null>(null);

  const populateForm = useCallback((c: CompAIConfig | null) => {
    setEnabled(c?.enabled ?? false);
    setDeviceId(c?.deviceId ?? "");
    setEndpoint(c?.endpoint ?? "");
    setAuthType(c?.authType ?? "none");
    setAuthToken(c?.authToken ?? "");
    setTimeoutMs(c?.timeoutMs ?? 10000);
    setWebhookSecret(c?.webhookSecret ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCompAIConfig()
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
    setTestResult(null);
    setDiscoverError(null);
    setZoneError(null);
    try {
      const payload: Partial<CompAIConfig> = {
        enabled,
        deviceId,
        endpoint: endpoint || null,
        authType,
        timeoutMs
      };
      if (authToken && !authToken.includes("••••")) {
        payload.authToken = authToken;
      }
      if (webhookSecret && !webhookSecret.includes("••••")) {
        payload.webhookSecret = webhookSecret;
      }
      const result = await updateCompAIConfig(payload);
      setConfig(result);
      populateForm(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
      onHealthChanged?.();
    }
  }, [enabled, deviceId, endpoint, authType, authToken, timeoutMs, webhookSecret, populateForm, onHealthChanged]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    setDiscoverError(null);
    setZoneError(null);
    try {
      const result = await testCompAIConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
      onHealthChanged?.();
    }
  }, [onHealthChanged]);

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    setDiscoverError(null);
    setError(null);
    setTestResult(null);
    setZoneError(null);
    try {
      const result = await discoverCompAIServices();
      setDiscoveredServices(result.services);
      setDeviceName(result.deviceName);
      setDeviceReachable(result.isReachable);
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : "Discovery failed");
      setDiscoveredServices([]);
    } finally {
      setDiscovering(false);
      onHealthChanged?.();
    }
  }, [onHealthChanged]);

  const handleLinkZone = useCallback(async (zoneId: string, serviceId: string) => {
    const service = discoveredServices.find((s) => s.id === serviceId);
    if (!service) return;

    setSavingZone(zoneId);
    setZoneError(null);
    setError(null);
    setDiscoverError(null);
    setTestResult(null);
    try {
      const compAI: CompAIZoneConfig = {
        serviceId: service.id,
        characteristics: {
          ...(service.characteristics.active ? { active: service.characteristics.active } : {}),
          ...(service.characteristics.setDuration ? { setDuration: service.characteristics.setDuration } : {}),
          ...(service.characteristics.inUse ? { inUse: service.characteristics.inUse } : {}),
          ...(service.characteristics.isConfigured ? { isConfigured: service.characteristics.isConfigured } : {}),
          ...(service.characteristics.remainingDuration ? { remainingDuration: service.characteristics.remainingDuration } : {}),
        }
      };
      await updateZone(zoneId, { compAI });
      onZonesChanged?.();
    } catch (err) {
      setZoneError(err instanceof Error ? err.message : "Failed to link zone");
    } finally {
      setSavingZone(null);
    }
  }, [discoveredServices, onZonesChanged]);

  const handleUnlinkZone = useCallback(async (zoneId: string) => {
    setSavingZone(zoneId);
    setZoneError(null);
    setError(null);
    setDiscoverError(null);
    setTestResult(null);
    try {
      await updateZone(zoneId, { compAI: null });
      onZonesChanged?.();
    } catch (err) {
      setZoneError(err instanceof Error ? err.message : "Failed to unlink zone");
    } finally {
      setSavingZone(null);
    }
  }, [onZonesChanged]);

  if (loading) {
    return <p className="muted">Loading CompAI config...</p>;
  }

  const mappedCount = zones.filter((z) => z.compAI?.serviceId).length;

  const serviceOptions = discoveredServices.map((s) => ({
    value: s.id,
    label: s.name,
  }));

  const usedServiceIds = new Set(
    zones.filter((z) => z.compAI?.serviceId).map((z) => z.compAI!.serviceId)
  );

  return (
    <div className="compai-settings">
      <header className="settings-section-header">
        <h3>CompAI Integration</h3>
      </header>
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
            aria-label="Enable CompAI integration"
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
          <label>Endpoint</label>
          <input
            type="url"
            value={endpoint}
            placeholder="https://compai-server.example.com"
            onChange={(e) => setEndpoint(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Device ID</label>
          <input
            type="text"
            value={deviceId}
            placeholder="F375E262-0840-4173-B076-99FE33E9F8E9"
            onChange={(e) => setDeviceId(e.target.value)}
            required
          />
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

        <fieldset className="form-fieldset">
          <legend>Webhook</legend>
          <div className="form-group">
            <label>Webhook Secret</label>
            <input
              type="password"
              value={webhookSecret}
              placeholder="Optional HMAC-SHA256 secret"
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
            <span className="form-hint">
              Leave blank to accept all requests without signature verification.
            </span>
          </div>
          {config?.lastWebhookAt && (
            <div className="form-group">
              <label>Last Webhook</label>
              <span className="form-hint" style={{ display: "block" }}>
                {new Date(config.lastWebhookAt).toLocaleString()}
              </span>
            </div>
          )}
        </fieldset>

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
            disabled={testing || !endpoint || !deviceId}
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
              disabled={saving || !deviceId}
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

      {/* ── Zone Mapping ── */}
      <div className="compai-zone-mapping">
        <header className="settings-section-header">
          <h3>Zone Mapping</h3>
          <span className="compai-zone-mapping__count">
            {mappedCount}/{zones.length} linked
          </span>
        </header>

        <div className="compai-zone-mapping__toolbar">
          <button
            type="button"
            className="ghost-button compai-discover-btn"
            onClick={handleDiscover}
            disabled={discovering || !endpoint || !deviceId}
          >
            {discovering ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9" /></svg>
            )}
            {discovering ? "Discovering..." : "Discover Services"}
          </button>
          {deviceName && (
            <span className="compai-device-badge">
              <span className={`compai-zone-item__dot${deviceReachable ? " compai-zone-item__dot--active" : ""}`} />
              {deviceName}
            </span>
          )}
        </div>

        {discoverError && <p className="zone-control-panel__error">{discoverError}</p>}
        {zoneError && <p className="zone-control-panel__error">{zoneError}</p>}

        <div className="compai-zone-list">
          {zones.map((zone) => {
            const isMapped = Boolean(zone.compAI?.serviceId);
            const isSaving = savingZone === zone.zoneId;
            const currentServiceId = zone.compAI?.serviceId ?? "";

            const availableOptions = [
              { value: "", label: "— Not linked —" },
              ...serviceOptions.filter(
                (o) => o.value === currentServiceId || !usedServiceIds.has(o.value)
              )
            ];

            return (
              <div
                key={zone.zoneId}
                className={`compai-zone-item${isMapped ? " compai-zone-item--mapped" : ""}`}
              >
                <div className="compai-zone-item__header compai-zone-item__header--static">
                  <div className="compai-zone-item__info">
                    <span className={`compai-zone-item__dot${isMapped ? " compai-zone-item__dot--active" : ""}`} />
                    <span className="compai-zone-item__name">{zone.name}</span>
                  </div>

                  {discoveredServices.length > 0 ? (
                    <div className="compai-zone-item__selector">
                      <Dropdown
                        value={currentServiceId}
                        options={availableOptions}
                        onChange={(value) => {
                          if (!value && isMapped) {
                            void handleUnlinkZone(zone.zoneId);
                          } else if (value && value !== currentServiceId) {
                            void handleLinkZone(zone.zoneId, value);
                          }
                        }}
                      />
                      {isSaving && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                      )}
                    </div>
                  ) : isMapped ? (
                    <div className="compai-zone-item__mapped-info">
                      <span className="compai-zone-item__service-id">{zone.compAI!.serviceId}</span>
                      <button
                        type="button"
                        className="ghost-button compai-zone-item__unlink"
                        onClick={() => void handleUnlinkZone(zone.zoneId)}
                        disabled={isSaving}
                        title="Unlink"
                      >
                        {isSaving ? "..." : "×"}
                      </button>
                    </div>
                  ) : (
                    <span className="compai-zone-item__service-id">Not linked</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {discoveredServices.length === 0 && !discoverError && (
          <p className="form-hint" style={{ marginTop: "var(--space-2)" }}>
            {endpoint && deviceId
              ? "Click \"Discover Services\" to fetch available services from the controller."
              : "Configure the endpoint and device ID above, then discover services."}
          </p>
        )}
      </div>
    </div>
  );
};

export default CompAISettings;
