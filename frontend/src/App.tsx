import { Routes, Route, NavLink, Link } from "react-router-dom";
import RecordsPage from "./pages/RecordsPage";
import IrrigationsPage from "./pages/IrrigationsPage";
import LogsPage from "./pages/LogsPage";
import AIRunsPage from "./pages/AIRunsPage";
import "./modal.css";
import SettingsPanel from "./components/SettingsPanel";
import DashboardView from "./components/DashboardView";
import { RefreshStatusIcon } from "./components/RefreshStatusIcons";
import HeaderHealthBar from "./components/HeaderHealthBar";
import type { ThemePreference } from "./hooks/useTheme";
import { useDashboardController } from "./hooks/useDashboardController";

const RefreshIcon = () => (
  <svg
    className="refresh-icon__svg"
    viewBox="0 0 24 24"
    role="img"
    aria-hidden="true"
  >
    <path
      d="M16.862 4.487l.613 3.175m0 0-3.175-.613m3.175.613-1.325-1.325A6.75 6.75 0 0 0 5.404 9.404M7.138 19.513l-.613-3.175m0 0 3.175.613m-3.175-.613 1.325 1.325A6.75 6.75 0 0 0 18.596 14.596"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
);

const THEME_CYCLE: ThemePreference[] = ["light", "dark", "system"];

/**
 * Thin app shell: header + nav + routes + settings panel. All data, realtime,
 * and refresh orchestration live in `useDashboardController`.
 */
const App = () => {
  const {
    themePreference,
    setThemePreference,
    integrationHealth,
    isRealtimePreferenceEnabled,
    handleRealtimePreferenceToggle,
    refreshStatusDisplay,
    isRefreshAnimating,
    handleForceRefresh,
    isSettingsPanelOpen,
    setIsSettingsPanelOpen,
    settingsTab,
    openSettings,
    toggleSettingsPanel,
    startDate,
    endDate,
    handleStartDateChange,
    handleEndDateChange,
    handleResetFilters,
    historyFiltersRef,
    status,
    latestHeartbeatSnapshot,
    heartbeatSeries,
    overviewStats,
    overviewLoading,
    overviewError,
    irrigationRecords,
    forecast,
    forecastLoading,
    forecastError,
    zones,
    zoneStates,
    zonesLoading,
    manualRun,
    rainPause,
    irrigationMode,
    aiScheduleEnabled,
    lastAIRun,
    lastAIRunEntries,
    debugModeActive,
    error,
    deviceConfig,
    deviceConfigLoading,
    handleDeviceConfigSave,
    latestIp,
    latestTempF,
    latestHumidity,
    latestBaselinePsi,
    lastHeartbeatText,
    rainAlertKey,
    aiRunRefreshKey,
    dashboardRunningAI,
    aiRunExpanded,
    setAiRunExpanded,
    loadZones,
    loadAIScheduleEnabled,
    refreshRainPause,
    setIrrigationMode,
    setDebugModeActive,
    handleDashboardRunAI
  } = useDashboardController();

  return (
    <main className="app">
      <header className="app-header">
        <Link to="/">
          <img
            src="banner.png"
            alt="Irrigo Logo"
            className="app-logo"
          />
        </Link>

        <div className="app-header-actions">
          <div className="app-header-actions-row">
            <button
              type="button"
              className={`refresh-icon-button${refreshStatusDisplay ? " refresh-icon-button--active" : ""}`}
              onClick={() => {
                void handleForceRefresh();
              }}
              disabled={isRefreshAnimating}
              aria-label={refreshStatusDisplay ? refreshStatusDisplay.label : "Force refresh data"}
              title={refreshStatusDisplay ? refreshStatusDisplay.label : "Refresh data"}
            >
              {refreshStatusDisplay ? (
                <RefreshStatusIcon
                  status={refreshStatusDisplay.key}
                  label={refreshStatusDisplay.label}
                />
              ) : (
                <span className="refresh-icon">
                  <RefreshIcon />
                </span>
              )}
            </button>
            <button
              type="button"
              className="theme-toggle-button"
              onClick={() => {
                const i = THEME_CYCLE.indexOf(themePreference);
                setThemePreference(THEME_CYCLE[(i + 1) % THEME_CYCLE.length]);
              }}
              aria-label={`Theme: ${themePreference}. Click to switch.`}
              title={`Theme: ${themePreference}`}
            >
              {themePreference === "dark" ? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              ) : themePreference === "light" ? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className="settings-gear-button"
              onClick={toggleSettingsPanel}
              aria-label="Open settings"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </button>
          </div>
          <HeaderHealthBar health={integrationHealth} />
        </div>
      </header>

      {debugModeActive && (
        <div className="debug-mode-banner" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 116 0v1" />
            <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6" />
            <path d="M12 20v2M6 13H2M22 13h-4M6 17H3.5M20.5 17H18M6 9H4M20 9h-2" />
          </svg>
          <span>Debug Mode Active — external calls are mocked</span>
          <button
            type="button"
            onClick={() => openSettings("preferences")}
          >
            Configure
          </button>
        </div>
      )}

      <nav className="app-nav">
        <NavLink to="/" end className={({ isActive }) => `app-nav__link${isActive ? " app-nav__link--active" : ""}`} title="Dashboard">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
        </NavLink>
        <NavLink to="/heartbeats" className={({ isActive }) => `app-nav__link${isActive ? " app-nav__link--active" : ""}`} title="Heartbeats">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
        </NavLink>
        <NavLink to="/irrigations" className={({ isActive }) => `app-nav__link${isActive ? " app-nav__link--active" : ""}`} title="Irrigations">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" /></svg>
        </NavLink>
        <NavLink to="/ai-runs" className={({ isActive }) => `app-nav__link${isActive ? " app-nav__link--active" : ""}`} title="AI Runs">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 2A2.5 2.5 0 0112 4.5v15a2.5 2.5 0 01-4.96.44 2.5 2.5 0 01-2.96-3.08 3 3 0 01-.34-5.58 2.5 2.5 0 011.32-4.24 2.5 2.5 0 011.44-3A2.5 2.5 0 019.5 2z" /><path d="M14.5 2A2.5 2.5 0 0012 4.5v15a2.5 2.5 0 004.96.44 2.5 2.5 0 002.96-3.08 3 3 0 00.34-5.58 2.5 2.5 0 00-1.32-4.24 2.5 2.5 0 00-1.44-3A2.5 2.5 0 0014.5 2z" /></svg>
        </NavLink>
        <NavLink to="/logs" className={({ isActive }) => `app-nav__link${isActive ? " app-nav__link--active" : ""}`} title="Logs">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
        </NavLink>
      </nav>

      <Routes>
        <Route path="/" element={
          <DashboardView
            status={status}
            latestHeartbeatSnapshot={latestHeartbeatSnapshot}
            forecast={forecast}
            forecastLoading={forecastLoading}
            forecastError={forecastError}
            overviewStats={overviewStats}
            overviewLoading={overviewLoading}
            overviewError={overviewError}
            heartbeatSeries={heartbeatSeries}
            zones={zones}
            zoneStates={zoneStates}
            zonesLoading={zonesLoading}
            irrigationRecords={irrigationRecords}
            manualRun={manualRun}
            rainPause={rainPause}
            irrigationMode={irrigationMode}
            aiScheduleEnabled={aiScheduleEnabled}
            lastAIRun={lastAIRun}
            lastAIRunEntries={lastAIRunEntries}
            heartbeatError={error}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={handleStartDateChange}
            onEndDateChange={handleEndDateChange}
            onResetFilters={handleResetFilters}
            historyFiltersRef={historyFiltersRef}
            rainAlertKey={rainAlertKey}
            aiRunRefreshKey={aiRunRefreshKey}
            dashboardRunningAI={dashboardRunningAI}
            aiRunExpanded={aiRunExpanded}
            setAiRunExpanded={setAiRunExpanded}
            onReloadZones={loadZones}
            onRefreshRainPause={refreshRainPause}
            onIrrigationModeChange={setIrrigationMode}
            onRunDashboardAI={handleDashboardRunAI}
            onOpenSettings={openSettings}
          />
        } />
        <Route path="/heartbeats" element={<RecordsPage />} />
        <Route path="/irrigations" element={<IrrigationsPage />} />
        <Route path="/ai-runs" element={<AIRunsPage zones={zones} />} />
        <Route path="/logs" element={<LogsPage />} />
      </Routes>

      <SettingsPanel
        open={isSettingsPanelOpen}
        onClose={() => setIsSettingsPanelOpen(false)}
        initialTab={settingsTab}
        zones={zones}
        zoneStates={zoneStates}
        zonesLoading={zonesLoading}
        onZonesChanged={loadZones}
        ip={latestIp}
        tempF={latestTempF}
        humidity={latestHumidity}
        baselinePsi={latestBaselinePsi}
        lastHeartbeat={lastHeartbeatText}
        deviceConfig={deviceConfig}
        isDeviceConfigLoading={deviceConfigLoading}
        onSaveConfig={handleDeviceConfigSave}
        isRealtimePreferenceEnabled={isRealtimePreferenceEnabled}
        onRealtimePreferenceToggle={handleRealtimePreferenceToggle}
        onAIScheduleConfigChanged={loadAIScheduleEnabled}
        onControllerHealthChanged={integrationHealth.recheckController}
        onDebugModeChanged={setDebugModeActive}
        aiRunRefreshKey={aiRunRefreshKey}
      />
    </main>
  );
};

export default App;
