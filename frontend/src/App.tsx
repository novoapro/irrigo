import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, NavLink, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import RecordsPage from "./pages/RecordsPage";
import IrrigationsPage from "./pages/IrrigationsPage";
import LogsPage from "./pages/LogsPage";
import AIRunsPage from "./pages/AIRunsPage";
import {
  buildRealtimeUrl,
  updateDeviceConfig,
  triggerAIScheduleRun,
  fetchStateSnapshot,
  type RainPauseStatus
} from "./api";
import type {
  DeviceConfig,
  DebugConfig,
  HeartbeatSeriesSample,
  IrrigationMode,
  SystemConfig,
  RealtimeEvent,
  SequentialRun,
  ZoneState
} from "./types";
import "./modal.css";
import SettingsPanel from "./components/SettingsPanel";
import DashboardView, { type SettingsTab } from "./components/DashboardView";
import {
  formatTimestamp,
  toQueryDateTime
} from "./utils/date";
import {
  RefreshStatusIcon,
  type RefreshStatusKey
} from "./components/RefreshStatusIcons";
import { useRealtimeChannel } from "./hooks/useRealtimeChannel";
import { useIntegrationHealth } from "./hooks/useIntegrationHealth";
import HeaderHealthBar from "./components/HeaderHealthBar";
import { useThemeContext } from "./ThemeContext";
import type { ThemePreference } from "./hooks/useTheme";
import { queryKeys } from "./queries/keys";
import {
  useStatusQuery,
  useHeartbeatPageQuery,
  useHeartbeatSeriesQuery,
  useHeartbeatOverviewQuery,
  useIrrigationRecordsQuery,
  useWeatherForecastQuery,
  useDeviceConfigQuery,
  useZonesQuery,
  useZoneStatesQuery,
  useSystemConfigQuery,
  useAIScheduleConfigQuery,
  useLastAIRunQuery,
  useManualRunQuery,
  useDebugConfigQuery,
  useRainPauseQuery
} from "./queries/dashboard";

type RefreshPhase =
  | "idle"
  | "sending"
  | "waiting-device"
  | "waiting-data"
  | "updating"
  | "success"
  | "error";

const REFRESH_SUCCESS_RESET_MS = 4000;
const LOCAL_REALTIME_PREF_KEY = "my-lawn-monitor:realtime-enabled";

// Stable empty default so `?? EMPTY_SERIES` doesn't create a fresh array each
// render (which would churn the useMemo deps that read it).
const EMPTY_SERIES: HeartbeatSeriesSample[] = [];

const errorMessage = (error: unknown, fallback: string): string | null => {
  if (!error) {
    return null;
  }
  return error instanceof Error ? error.message : fallback;
};

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

const App = () => {
  const queryClient = useQueryClient();
  const { preference: themePreference, setPreference: setThemePreference } = useThemeContext();

  // --- UI-only state (server data lives in the TanStack Query cache) ---
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [page, setPage] = useState<number>(1);
  const [refreshPhase, setRefreshPhase] = useState<RefreshPhase>("idle");
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("zones");
  const [aiRunExpanded, setAiRunExpanded] = useState(false);
  const [aiRunRefreshKey, setAiRunRefreshKey] = useState(0);
  const [dashboardRunningAI, setDashboardRunningAI] = useState(false);
  const [rainAlertKey, setRainAlertKey] = useState(0);
  const [deviceConfigBusy, setDeviceConfigBusy] = useState(false);

  const activeRefreshIdRef = useRef<number | null>(null);
  const refreshCompletionTimeoutRef = useRef<number | null>(null);
  const historyFiltersRef = useRef<HTMLDivElement | null>(null);
  const realtimeEventHandlerRef = useRef<(event: RealtimeEvent) => void>(() => { });

  const realtimeUrl = useMemo(() => buildRealtimeUrl(), []);

  const {
    status: realtimeStatus,
    isActive: isRealtimeActive,
    isPreferenceEnabled: isRealtimePreferenceEnabled,
    togglePreference: toggleRealtimePreference,
    activateManualSession,
    deactivateManualSession,
    resetBackoff: resetRealtimeBackoff
  } = useRealtimeChannel({
    url: realtimeUrl,
    preferenceKey: LOCAL_REALTIME_PREF_KEY,
    onEvent: (event) => realtimeEventHandlerRef.current(event)
  });

  // --- history window shared by the heartbeat/overview query families ---
  const historyWindow = useMemo(
    () => ({ start: toQueryDateTime(startDate), end: toQueryDateTime(endDate) }),
    [startDate, endDate]
  );

  // --- server-data queries ---
  const statusQuery = useStatusQuery(isRealtimeActive);
  const heartbeatPageQuery = useHeartbeatPageQuery(historyWindow, page, isRealtimeActive);
  const heartbeatSeriesQuery = useHeartbeatSeriesQuery(historyWindow, isRealtimeActive);
  const overviewQuery = useHeartbeatOverviewQuery(historyWindow, isRealtimeActive);
  const irrigationRecordsQuery = useIrrigationRecordsQuery(isRealtimeActive);
  const forecastQuery = useWeatherForecastQuery(isRealtimeActive);
  const deviceConfigQuery = useDeviceConfigQuery(isRealtimeActive);
  const zonesQuery = useZonesQuery();
  const zoneStatesQuery = useZoneStatesQuery();
  const systemConfigQuery = useSystemConfigQuery();
  const aiScheduleConfigQuery = useAIScheduleConfigQuery();
  const lastAIRunQuery = useLastAIRunQuery();
  const manualRunQuery = useManualRunQuery();
  const debugConfigQuery = useDebugConfigQuery();
  const rainPauseQuery = useRainPauseQuery();

  // --- derived read-model shared across the shell + dashboard ---
  const status = statusQuery.data ?? null;
  const heartbeatSeries = heartbeatSeriesQuery.data ?? EMPTY_SERIES;
  const latestHeartbeatSnapshot = heartbeatPageQuery.data?.data?.[0] ?? null;
  const overviewStats = overviewQuery.data ?? null;
  const irrigationRecords = irrigationRecordsQuery.data ?? [];
  const forecast = forecastQuery.data ?? null;
  const deviceConfig = deviceConfigQuery.data ?? null;
  const zones = zonesQuery.data ?? [];
  const zoneStates = zoneStatesQuery.data ?? {};
  const zonesLoading = zonesQuery.isLoading;
  const manualRun = manualRunQuery.data ?? null;
  const irrigationMode = systemConfigQuery.data?.irrigationMode ?? "smart";
  const aiScheduleEnabled = aiScheduleConfigQuery.data?.enabled ?? false;
  const lastAIRun = lastAIRunQuery.data?.run ?? null;
  const lastAIRunEntries = lastAIRunQuery.data?.entries ?? [];
  const debugModeActive = debugConfigQuery.data?.enabled ?? false;
  const rainPause: RainPauseStatus = rainPauseQuery.data ?? { active: false };

  const error = errorMessage(heartbeatPageQuery.error, "Unable to load heartbeats");
  const forecastLoading = forecastQuery.isLoading;
  const forecastError = errorMessage(forecastQuery.error, "Unable to load forecast");
  const overviewLoading = overviewQuery.isLoading;
  const overviewError = errorMessage(overviewQuery.error, "Unable to load heartbeat overview");
  const deviceConfigLoading = deviceConfigQuery.isLoading || deviceConfigBusy;

  const integrationHealth = useIntegrationHealth({
    realtimeStatus,
    isRealtimeActive,
    forecastError,
    hasForecast: forecast !== null
  });

  // --- cache-write helpers used by the realtime handler & child callbacks ---
  const loadZones = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.zones });
    void queryClient.invalidateQueries({ queryKey: queryKeys.zoneStates });
  }, [queryClient]);

  const loadStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.status });
  }, [queryClient]);

  const loadDeviceConfig = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.deviceConfig });
  }, [queryClient]);

  const loadLastAIRun = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.lastAIRun }),
    [queryClient]
  );

  const loadAIScheduleEnabled = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.aiScheduleConfig });
  }, [queryClient]);

  const setIrrigationMode = useCallback(
    (mode: IrrigationMode) => {
      queryClient.setQueryData<SystemConfig | null>(queryKeys.systemConfig, (old) => ({
        ...(old ?? {}),
        irrigationMode: mode
      }));
    },
    [queryClient]
  );

  const setDebugModeActive = useCallback(
    (enabled: boolean) => {
      queryClient.setQueryData<DebugConfig | null>(queryKeys.debugConfig, (old) => ({
        ...(old ?? {}),
        enabled
      }));
    },
    [queryClient]
  );

  const refreshRainPause = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.rainPause });
    setRainAlertKey((k) => k + 1);
  }, [queryClient]);

  const forceHearbeat = useCallback(async () => {
    setDeviceConfigBusy(true);
    try {
      const baseConfig = deviceConfig ?? undefined;
      const config = await updateDeviceConfig({
        ...(baseConfig ?? {}),
        forceHeartbeat: true
      });
      if (config) {
        queryClient.setQueryData(queryKeys.deviceConfig, config);
      }
      return true;
    } catch (error) {
      console.error("Failed to force a heartBeat:", error);
      return false;
    } finally {
      setDeviceConfigBusy(false);
    }
  }, [deviceConfig, queryClient]);

  const handleDeviceConfigSave = useCallback(
    async (config: DeviceConfig) => {
      const updated = await updateDeviceConfig(config);
      if (updated) {
        queryClient.setQueryData(queryKeys.deviceConfig, updated);
      }
    },
    [queryClient]
  );

  // --- values the header + settings panel need from the latest reading ---
  const lastUpdate =
    status?.lastUpdatedAt ??
    latestHeartbeatSnapshot?.timestamp ??
    null;
  const hasHeartbeatData = Boolean(status || latestHeartbeatSnapshot);
  const lastHeartbeatText = hasHeartbeatData && lastUpdate
    ? formatTimestamp(lastUpdate)
    : "—";
  const latestTempF = status?.device?.tempF ?? latestHeartbeatSnapshot?.device.tempF;
  const latestHumidity =
    status?.device?.humidity ?? latestHeartbeatSnapshot?.device.humidity;
  const latestBaselinePsi =
    status?.device?.baselinePsi ?? latestHeartbeatSnapshot?.device.baselinePsi;
  const latestIp = status?.device?.ip ?? latestHeartbeatSnapshot?.device.ip;

  const clearRefreshCompletionTimer = useCallback(() => {
    if (refreshCompletionTimeoutRef.current) {
      window.clearTimeout(refreshCompletionTimeoutRef.current);
      refreshCompletionTimeoutRef.current = null;
    }
  }, []);

  const markRefreshSuccess = useCallback(() => {
    clearRefreshCompletionTimer();
    setRefreshPhase("success");
    deactivateManualSession();
    refreshCompletionTimeoutRef.current = window.setTimeout(() => {
      setRefreshPhase("idle");
      refreshCompletionTimeoutRef.current = null;
    }, REFRESH_SUCCESS_RESET_MS);
  }, [clearRefreshCompletionTimer, deactivateManualSession]);

  const markRefreshError = useCallback(() => {
    activeRefreshIdRef.current = null;
    clearRefreshCompletionTimer();
    setRefreshPhase("error");
    deactivateManualSession();
    refreshCompletionTimeoutRef.current = window.setTimeout(() => {
      setRefreshPhase("idle");
      refreshCompletionTimeoutRef.current = null;
    }, REFRESH_SUCCESS_RESET_MS);
  }, [clearRefreshCompletionTimer, deactivateManualSession]);

  const isRefreshAnimating = refreshPhase !== "idle" && refreshPhase !== "success" && refreshPhase !== "error";

  const refreshStatusDisplay = useMemo((): { key: RefreshStatusKey; label: string } | null => {
    switch (refreshPhase) {
      case "sending":
        return { key: "sending", label: "Sending command to device…" };
      case "waiting-device":
        return { key: "waiting-device", label: "Awaiting device acknowledgement…" };
      case "waiting-data":
        return { key: "waiting-data", label: "Listening for new heartbeat…" };
      case "updating":
        return { key: "updating", label: "Syncing live data…" };
      case "success":
        return { key: "success", label: "Latest data received" };
      case "error":
        return { key: "error", label: "Refresh failed · tap to retry" };
      default:
        return null;
    }
  }, [refreshPhase]);

  const handleResetFilters = useCallback(() => {
    setStartDate(null);
    setEndDate(null);
    setPage(1);
  }, []);

  const handleStartDateChange = useCallback(
    (value: Date | null) => {
      setStartDate(value);
      setPage(1);
      if (value && endDate && value > endDate) {
        setEndDate(null);
      }
    },
    [endDate]
  );

  const handleEndDateChange = useCallback((value: Date | null) => {
    setEndDate(value);
    setPage(1);
  }, []);

  const toggleSettingsPanel = useCallback(() => {
    setIsSettingsPanelOpen((prev) => !prev);
  }, []);

  const openSettings = useCallback((tab: SettingsTab) => {
    setSettingsTab(tab);
    setIsSettingsPanelOpen(true);
  }, []);

  const handleDashboardRunAI = useCallback(async () => {
    setDashboardRunningAI(true);
    try {
      await triggerAIScheduleRun();
      await queryClient.invalidateQueries({ queryKey: queryKeys.lastAIRun });
      setAiRunRefreshKey((k) => k + 1);
    } catch { /* ignore */ }
    setDashboardRunningAI(false);
  }, [queryClient]);

  const handleForceRefresh = useCallback(async () => {
    if (isRefreshAnimating) {
      return;
    }
    activateManualSession();
    resetRealtimeBackoff();
    activeRefreshIdRef.current = Date.now();
    clearRefreshCompletionTimer();
    setRefreshPhase("sending");

    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.status }),
        queryClient.invalidateQueries({ queryKey: ["heartbeats"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.irrigationRecords }),
        queryClient.invalidateQueries({ queryKey: queryKeys.weatherForecast })
      ]);
      const forced = await forceHearbeat();
      if (!forced) {
        markRefreshError();
      } else {
        setRefreshPhase("waiting-device");
      }
    } catch (error) {
      console.error("Failed to trigger refresh:", error);
      markRefreshError();
    }
  }, [
    isRefreshAnimating,
    activateManualSession,
    resetRealtimeBackoff,
    clearRefreshCompletionTimer,
    queryClient,
    forceHearbeat,
    markRefreshError
  ]);

  const handleRealtimePreferenceToggle = useCallback(
    (enabled: boolean) => {
      toggleRealtimePreference(enabled);
    },
    [toggleRealtimePreference]
  );

  const syncDataAfterHeartbeat = useCallback(
    async (shouldMarkRefresh: boolean) => {
      try {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.status }),
          queryClient.invalidateQueries({ queryKey: ["heartbeats"] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.irrigationRecords }),
          queryClient.invalidateQueries({ queryKey: queryKeys.weatherForecast })
        ]);
        refreshRainPause();
        if (shouldMarkRefresh) {
          markRefreshSuccess();
        }
      } catch (error) {
        console.error("Failed to synchronise after heartbeat:", error);
        if (shouldMarkRefresh) {
          markRefreshError();
        }
      }
    },
    [queryClient, refreshRainPause, markRefreshSuccess, markRefreshError]
  );

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      switch (event.type) {
        case "connection:ready": {
          void fetchStateSnapshot().then((snapshot) => {
            if (snapshot.status) {
              queryClient.setQueryData(queryKeys.status, snapshot.status);
            }
            queryClient.setQueryData(
              queryKeys.manualRun,
              (snapshot.activeRun as SequentialRun) ?? null
            );
            if (snapshot.irrigationMode) {
              setIrrigationMode(snapshot.irrigationMode as IrrigationMode);
            }
            if (snapshot.rainPause) {
              queryClient.setQueryData(queryKeys.rainPause, snapshot.rainPause);
            }
            if (snapshot.zoneStates) {
              const stateMap: Record<string, ZoneState> = {};
              for (const zs of snapshot.zoneStates) {
                stateMap[zs.zoneId] = zs;
              }
              queryClient.setQueryData(queryKeys.zoneStates, stateMap);
            }
          }).catch(() => {});
          break;
        }
        case "forceHeartbeat:queued": {
          if (activeRefreshIdRef.current !== null) {
            setRefreshPhase("waiting-device");
          }
          break;
        }
        case "forceHeartbeat:acknowledged": {
          loadDeviceConfig();
          if (activeRefreshIdRef.current !== null) {
            setRefreshPhase("waiting-data");
          }
          break;
        }
        case "heartbeat:new": {
          const hadActiveRefresh = activeRefreshIdRef.current !== null;
          if (hadActiveRefresh) {
            activeRefreshIdRef.current = null;
            setRefreshPhase("updating");
          }
          void syncDataAfterHeartbeat(hadActiveRefresh);
          break;
        }

        case "forecast:new": {
          if (event?.payload) {
            queryClient.setQueryData(queryKeys.weatherForecast, event.payload);
          }
          break;
        }
        case "status:updated": {
          loadStatus();
          break;
        }
        case "irrigation:updated": {
          void queryClient.invalidateQueries({ queryKey: queryKeys.irrigationRecords });
          loadZones();
          loadStatus();
          break;
        }
        case "deviceConfig:updated": {
          if (event.payload) {
            queryClient.setQueryData(queryKeys.deviceConfig, event.payload);
          } else {
            loadDeviceConfig();
          }
          break;
        }
        case "zone:created":
        case "zone:updated":
        case "zone:deleted": {
          loadZones();
          break;
        }
        case "command:created":
        case "command:updated": {
          loadZones();
          break;
        }
        case "zoneState:changed": {
          if (event.payload && "zoneId" in event.payload) {
            const statePayload = event.payload as ZoneState;
            // Cancel any in-flight zoneStates refetch (e.g. from a concurrent
            // loadZones) before applying this fresh single-zone update, so the
            // refetch resolving later can't clobber it.
            void queryClient.cancelQueries({ queryKey: queryKeys.zoneStates }).then(() => {
              queryClient.setQueryData<Record<string, ZoneState>>(
                queryKeys.zoneStates,
                (prev) => ({ ...(prev ?? {}), [statePayload.zoneId]: statePayload })
              );
            });
          } else {
            loadZones();
          }
          break;
        }
        case "schedule:runCompleted": {
          loadLastAIRun();
          loadAIScheduleEnabled();
          loadZones();
          setAiRunRefreshKey((k) => k + 1);
          setDashboardRunningAI(false);
          break;
        }
        case "systemConfig:updated": {
          if (event.payload && "irrigationMode" in event.payload) {
            setIrrigationMode(event.payload.irrigationMode as IrrigationMode);
          }
          break;
        }
        case "sequentialRun:started":
        case "sequentialRun:zoneProgress":
        case "sequentialRun:completed":
        case "sequentialRun:cancelled": {
          if (event.payload) {
            queryClient.setQueryData(queryKeys.manualRun, event.payload as SequentialRun);
          }
          if (event.type === "sequentialRun:completed" || event.type === "sequentialRun:cancelled") {
            loadZones();
          }
          break;
        }
        case "deferral:triggered":
        case "deferral:recovered":
        case "deferral:expired": {
          loadZones();
          setAiRunRefreshKey((k) => k + 1);
          break;
        }
        case "program:created":
        case "program:updated":
        case "program:deleted":
        case "program:triggered": {
          setAiRunRefreshKey((k) => k + 1);
          break;
        }
        case "debugMode:changed": {
          const enabled = (event.payload as { enabled?: boolean })?.enabled ?? false;
          setDebugModeActive(enabled);
          break;
        }
        case "rain:confirmed": {
          refreshRainPause();
          setAiRunRefreshKey((k) => k + 1);
          break;
        }
        case "rain:promptResponded":
        case "rain:pauseCleared": {
          refreshRainPause();
          break;
        }
        default:
          break;
      }
  },
  [queryClient, loadDeviceConfig, loadStatus, loadZones, loadLastAIRun, loadAIScheduleEnabled, syncDataAfterHeartbeat, refreshRainPause, setIrrigationMode, setDebugModeActive]
  );

  useEffect(() => {
    realtimeEventHandlerRef.current = handleRealtimeEvent;
  }, [handleRealtimeEvent]);

  useEffect(() => {
    return () => {
      clearRefreshCompletionTimer();
    };
  }, [clearRefreshCompletionTimer]);

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
