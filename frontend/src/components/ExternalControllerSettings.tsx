import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ExternalControllerConfig, Zone } from "../types";
import {
  fetchExternalControllerConfig,
  updateExternalControllerConfig,
  testExternalController
} from "../api";
import Dropdown from "./Dropdown";
import ActionButton, { CheckIcon, TestIcon } from "./ActionButton";
import { useActionStatus } from "../hooks/useActionStatus";

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
  const { data: config, isLoading } = useQuery({
    queryKey: ["externalControllerConfig"],
    queryFn: async () => (await fetchExternalControllerConfig()) ?? null
  });

  if (isLoading) {
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

      {!collapsed && (
        <ExternalControllerForm
          key={config?.updatedAt ?? config?._id ?? "new"}
          initialConfig={config ?? null}
          zones={zones}
        />
      )}
    </div>
  );
};

interface ExternalControllerFormProps {
  initialConfig: ExternalControllerConfig | null;
  zones: Zone[];
}

const ExternalControllerForm = ({ initialConfig, zones }: ExternalControllerFormProps) => {
  const queryClient = useQueryClient();
  const { status: saveStatus, wrap: wrapSave } = useActionStatus();
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initialConfig?.name ?? "");
  const [endpoint, setEndpoint] = useState(initialConfig?.endpoint ?? "");
  const [authType, setAuthType] = useState<"none" | "bearer" | "apikey" | "basic">(initialConfig?.authType ?? "none");
  const [authToken, setAuthToken] = useState(initialConfig?.authToken ?? "");
  const [commandPath, setCommandPath] = useState(initialConfig?.commandPath ?? "");
  const [timeoutMs, setTimeoutMs] = useState(initialConfig?.timeoutMs ?? 10000);
  const [enabled, setEnabled] = useState(initialConfig?.enabled ?? true);
  const [zoneMapping, setZoneMapping] = useState<Record<string, string>>(initialConfig?.zoneMapping ?? {});

  const handleSave = useCallback(async () => {
    setError(null);
    try {
      await wrapSave(async () => {
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
        await updateExternalControllerConfig(payload);
        await queryClient.invalidateQueries({ queryKey: ["externalControllerConfig"] });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  }, [name, endpoint, authType, authToken, commandPath, timeoutMs, enabled, zoneMapping, queryClient, wrapSave]);

  const handleTest = useCallback(async () => {
    setTestResult(null);
    const result = await testExternalController();
    setTestResult(result);
    if (!result.success) throw new Error(result.message);
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

  return (
    <>
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
          <ActionButton
            icon={<TestIcon />}
            variant="ghost"
            action={handleTest}
            disabled={!endpoint}
            successLabel="OK"
            errorLabel="Failed"
            title="Test connection"
            aria-label="Test connection"
          />
          <div className="form-actions-right">
            <ActionButton
              icon={<CheckIcon />}
              variant="primary"
              type="submit"
              status={saveStatus}
              successLabel="Saved"
              errorLabel="Error"
              disabled={!endpoint}
              title="Save"
              aria-label="Save"
            />
          </div>
        </div>
      </form>
    </>
  );
};

export default ExternalControllerSettings;
