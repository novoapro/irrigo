import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  buildRealtimeUrl,
  updateDeviceConfig,
  triggerAIScheduleRun,
  fetchStateSnapshot,
  type RainPauseStatus
} from "../api";
import type {
  DeviceConfig,
  DebugConfig,
  HeartbeatSeriesSample,
  IrrigationMode,
  SystemConfig,
  RealtimeEvent,
  SequentialRun,
  ZoneState
} from "../types";
import { formatTimestamp, toQueryDateTime } from "../utils/date";
import { type RefreshStatusKey } from "../components/RefreshStatusIcons";
import { useRealtimeChannel } from "./useRealtimeChannel";
import { useIntegrationHealth } from "./useIntegrationHealth";
import { useThemeContext } from "../ThemeContext";
import { queryKeys } from "../queries/keys";
import { type SettingsTab } from "../components/DashboardView";
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
} from "../queries/dashboard";

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

/**
 * The dashboard controller (Phase 3 decomposition). Owns all of the app's
 * server-data queries, the derived read-model, the realtime event fan-out
 * (routed through the TanStack Query cache), and the manual-refresh lifecycle.
 * `App` is a thin shell that renders this hook's result.
 */
export const useDashboardController = () => {
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

  return {
    // theme
    themePreference,
    setThemePreference,
    // realtime + health
    integrationHealth,
    isRealtimePreferenceEnabled,
    handleRealtimePreferenceToggle,
    // refresh lifecycle
    refreshStatusDisplay,
    isRefreshAnimating,
    handleForceRefresh,
    // settings panel + navigation
    isSettingsPanelOpen,
    setIsSettingsPanelOpen,
    settingsTab,
    openSettings,
    toggleSettingsPanel,
    // filters
    startDate,
    endDate,
    handleStartDateChange,
    handleEndDateChange,
    handleResetFilters,
    historyFiltersRef,
    // dashboard server data
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
    // device + settings-panel data
    deviceConfig,
    deviceConfigLoading,
    handleDeviceConfigSave,
    latestIp,
    latestTempF,
    latestHumidity,
    latestBaselinePsi,
    lastHeartbeatText,
    // cross-cutting UI state + cache writers
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
  };
};
