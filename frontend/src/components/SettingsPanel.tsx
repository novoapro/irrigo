import { useState, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { DeviceConfig, Zone, ZoneState } from "../types";
import ZoneControlPanel from "./ZoneControlPanel";
import DeviceWidget from "./DeviceWidget";
import AIScheduleConfigModal from "./AIScheduleConfigModal";
import ExternalControllerSettings from "./ExternalControllerSettings";
import ScheduledProgramsPanel from "./ScheduledProgramsPanel";

type SettingsTab = "zones" | "device" | "schedule" | "programs" | "integrations" | "preferences";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
  zones: Zone[];
  zoneStates: Record<string, ZoneState>;
  zonesLoading: boolean;
  onZonesChanged: () => void;
  ip?: string;
  tempF?: number;
  humidity?: number;
  baselinePsi?: number;
  lastHeartbeat: string;
  deviceConfig: DeviceConfig | null;
  isDeviceConfigLoading: boolean;
  onSaveConfig: (config: DeviceConfig) => Promise<void>;
  isRealtimePreferenceEnabled: boolean;
  onRealtimePreferenceToggle: (enabled: boolean) => void;
  onAIScheduleConfigChanged?: () => void;
}

const TabIcon = ({ name }: { name: SettingsTab }) => {
  const props = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "zones": return <svg {...props}><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" /></svg>;
    case "device": return <svg {...props}><rect x="6" y="3" width="12" height="18" rx="1" /><path d="M6 7h12M6 17h12" /><line x1="9" y1="3" x2="9" y2="7" /><line x1="15" y1="3" x2="15" y2="7" /><line x1="9" y1="17" x2="9" y2="21" /><line x1="15" y1="17" x2="15" y2="21" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>;
    case "schedule": return <svg {...props}><path d="M12 2a4 4 0 014 4c0 1.95-1.4 3.58-3.25 3.93V12h2.75a2.5 2.5 0 012.5 2.5v1a2.5 2.5 0 01-2.5 2.5H8.5A2.5 2.5 0 016 15.5v-1A2.5 2.5 0 018.5 12h2.75V9.93A4.002 4.002 0 018 6a4 4 0 014-4z" /><path d="M10 18v2a2 2 0 104 0v-2" /><circle cx="10" cy="6" r="0.5" fill="currentColor" /><circle cx="14" cy="6" r="0.5" fill="currentColor" /></svg>;
    case "programs": return <svg {...props}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
    case "integrations": return <svg {...props}><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>;
    case "preferences": return <svg {...props}><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>;
  }
};

const BASE_TABS: { key: SettingsTab; label: string }[] = [
  { key: "zones", label: "Zones" },
  { key: "device", label: "Device" },
  { key: "schedule", label: "Smart Schedule" },
  { key: "programs", label: "Programs" },
  { key: "integrations", label: "Integrations" },
  { key: "preferences", label: "Preferences" },
];

const SettingsPanel = ({
  open,
  onClose,
  initialTab,
  zones,
  zoneStates,
  zonesLoading,
  onZonesChanged,
  ip,
  tempF,
  humidity,
  baselinePsi,
  lastHeartbeat,
  deviceConfig,
  isDeviceConfigLoading,
  onSaveConfig,
  isRealtimePreferenceEnabled,
  onRealtimePreferenceToggle,
  onAIScheduleConfigChanged,
}: SettingsPanelProps) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? "zones");

  const TABS = useMemo(() =>
    BASE_TABS.map((tab) =>
      tab.key === "device" && deviceConfig?.deviceName
        ? { ...tab, label: deviceConfig.deviceName }
        : tab
    ),
    [deviceConfig?.deviceName]
  );

  useEffect(() => {
    if (open && initialTab) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  const handleScheduleSaved = useCallback(() => {
    onZonesChanged();
    onAIScheduleConfigChanged?.();
  }, [onZonesChanged, onAIScheduleConfigChanged]);

  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="settings-panel">
        <header className="settings-panel__header">
          <h2>Settings</h2>
          <button
            type="button"
            className="settings-panel__close"
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </header>

        <div className="settings-panel__body">
          <nav className="settings-panel__tabs" role="tablist">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                aria-label={tab.label}
                title={tab.label}
                className={`settings-tab-btn${activeTab === tab.key ? " settings-tab-btn--active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <TabIcon name={tab.key} />
                <span>{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="settings-panel__content" role="tabpanel">
            {activeTab === "zones" && (
              <ZoneControlPanel
                zones={zones}
                zoneStates={zoneStates}
                loading={zonesLoading}
                onZonesChanged={onZonesChanged}
                mode="manage"
              />
            )}

            {activeTab === "device" && (
              <DeviceWidget
                ip={ip}
                tempF={tempF}
                humidity={humidity}
                baselinePsi={baselinePsi}
                lastHeartbeat={lastHeartbeat}
                deviceConfig={deviceConfig}
                isDeviceConfigLoading={isDeviceConfigLoading}
                onSaveConfig={onSaveConfig}
              />
            )}

            {activeTab === "schedule" && (
              <AIScheduleConfigModal
                open={true}
                inline={true}
                onClose={() => {}}
                onSaved={handleScheduleSaved}
              />
            )}

            {activeTab === "programs" && (
              <ScheduledProgramsPanel
                zones={zones}
                onScheduleChanged={onZonesChanged}
              />
            )}

            {activeTab === "integrations" && (
              <ExternalControllerSettings zones={zones} />
            )}

            {activeTab === "preferences" && (
              <div className="settings-preferences">
                <h3>Live Updates</h3>
                <label className="checkbox-label device-panel-preference">
                  <input
                    type="checkbox"
                    checked={isRealtimePreferenceEnabled}
                    onChange={(e) => onRealtimePreferenceToggle(e.target.checked)}
                  />
                  <span>Enable real-time updates while app is open</span>
                </label>
                <p className="device-panel-preference__hint">
                  When enabled, the app maintains a live connection to receive instant updates from your device.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default SettingsPanel;
