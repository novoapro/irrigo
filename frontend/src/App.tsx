import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, NavLink, Link } from "react-router-dom";
import { format } from "date-fns";
import DateTimeInput from "./components/DateTimeInput";
import RecordsPage from "./pages/RecordsPage";
import IrrigationsPage from "./pages/IrrigationsPage";
import LogsPage from "./pages/LogsPage";
import AIRunsPage from "./pages/AIRunsPage";
import {
  buildRealtimeUrl,
  fetchDeviceConfig,
  updateDeviceConfig,
  fetchHeartbeatOverview,
  fetchHeartbeats,
  fetchHeartbeatSeries,
  fetchIrrigationEvents,
  fetchLatestIrrigationPerZone,
  fetchStatus,
  fetchAIScheduleConfig,
  fetchScheduleRuns,
  fetchScheduleRun,
  fetchSystemConfig,
  triggerAIScheduleRun,
  fetchWeatherForecast,
  fetchZones,
  fetchZoneStates,
  getManualRunStatus
} from "./api";
import type {
  DeviceConfig,
  Heartbeat,
  HeartbeatListMeta,
  HeartbeatOverviewStats,
  HeartbeatSeriesSample,
  IrrigationEvent,
  IrrigationMode,
  IrrigationRecord,
  ScheduleEntry,
  ScheduleRun,
  StatusPayload,
  WeatherOverviewPayload,
  WeatherConditionsSnapshot,
  RealtimeEvent,
  SequentialRun,
  Zone,
  ZoneState
} from "./types";
import "./modal.css";
import WeatherWidget, { type PrecipitationPoint } from "./components/WeatherWidget";
import ZoneControlPanel from "./components/ZoneControlPanel";
import IrrigationQueuePanel from "./components/IrrigationQueuePanel";
import SettingsPanel from "./components/SettingsPanel";
import OverviewSection, {
  type OverviewCardDefinition
} from "./components/OverviewSection";
import { GuardCard } from "./components/status/GuardCard";
import {
  SensorWidget,
  type StatusTone
} from "./components/status/SensorWidgets";
import { StatusPanel } from "./components/status/StatusPanel";
import {
  formatTimestamp,
  toQueryDateTime
} from "./utils/date";
import { getRainIndicatorIcon } from "./utils/weather";
import { getSensorIcon } from "./utils/sensors";
import {
  RefreshStatusIcon,
  type RefreshStatusKey
} from "./components/RefreshStatusIcons";
import { useRealtimeChannel } from "./hooks/useRealtimeChannel";
import { useIntegrationHealth } from "./hooks/useIntegrationHealth";
import HeaderHealthBar from "./components/HeaderHealthBar";

type LoadState = "idle" | "loading" | "ready" | "error";

type RefreshPhase =
  | "idle"
  | "sending"
  | "waiting-device"
  | "waiting-data"
  | "updating"
  | "success"
  | "error";

const HEARTBEAT_PAGE_SIZE = 15;
const HEARTBEAT_SERIES_LIMIT = 250;
const STATUS_REFRESH_MS = 15 * 60000;
const HEARTBEAT_REFRESH_MS = 15 * 60000;
const FORECAST_REFRESH_MS = 15 * 60000;
const DEVICE_CONFIG_REFRESH_MS = 10 * 60000;
const REFRESH_SUCCESS_RESET_MS = 4000;
const LOCAL_REALTIME_PREF_KEY = "my-lawn-monitor:realtime-enabled";

type ComparableValue = boolean | number;

const getLastChangeTimestamp = <Value extends ComparableValue>(
  heartbeats: Heartbeat[],
  selector: (heartbeat: Heartbeat) => Value,
  isEqual: (a: Value, b: Value) => boolean = (a, b) => a === b
): string | null => {
  if (heartbeats.length === 0) {
    return null;
  }

  const sorted = [...heartbeats].sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  let previousValue = selector(sorted[0]);

  for (let index = 1; index < sorted.length; index += 1) {
    const currentValue = selector(sorted[index]);
    if (!isEqual(currentValue, previousValue)) {
      return sorted[index - 1].timestamp;
    }
    previousValue = currentValue;
  }

  return sorted[sorted.length - 1].timestamp;
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

const App = () => {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [heartbeatSeries, setHeartbeatSeries] = useState<HeartbeatSeriesSample[]>([]);
  const [heartbeatPage, setHeartbeatPage] = useState<Heartbeat[]>([]);
  const [heartbeatMeta, setHeartbeatMeta] = useState<HeartbeatListMeta | null>(null);
  const [irrigationEvents, setIrrigationEvents] = useState<IrrigationEvent[]>([]);
  const [irrigationMeta, setIrrigationMeta] = useState<HeartbeatListMeta | null>(null);
  const [irrigationLoading, setIrrigationLoading] = useState<boolean>(false);
  const [irrigationError, setIrrigationError] = useState<string | null>(null);
  const [irrigationRecords, setIrrigationRecords] = useState<IrrigationRecord[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [forecast, setForecast] = useState<WeatherOverviewPayload | null>(null);
  const [forecastLoading, setForecastLoading] = useState<boolean>(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [overviewStats, setOverviewStats] = useState<HeartbeatOverviewStats | null>(null);
  const [overviewLoading, setOverviewLoading] = useState<boolean>(false);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [latestHeartbeatSnapshot, setLatestHeartbeatSnapshot] = useState<Heartbeat | null>(null);
  const [page, setPage] = useState<number>(1);
  const [nextStatusRefreshAt, setNextStatusRefreshAt] = useState<number | null>(null);
  const [nextHeartbeatRefreshAt, setNextHeartbeatRefreshAt] = useState<number | null>(null);
  const [nextForecastRefreshAt, setNextForecastRefreshAt] = useState<number | null>(null);
  const [newForecastPushedAt, setNewForecastPushedAt] = useState<number | null>(null);
  const [nextDeviceConfigRefreshAt, setNextDeviceConfigRefreshAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [deviceConfig, setDeviceConfig] = useState<DeviceConfig | null>(null);
  const [deviceConfigLoading, setDeviceConfigLoading] = useState<boolean>(false);
  const [refreshPhase, setRefreshPhase] = useState<RefreshPhase>("idle");
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneStates, setZoneStates] = useState<Record<string, ZoneState>>({});
  const [zonesLoading, setZonesLoading] = useState(false);
  const [manualRun, setManualRun] = useState<SequentialRun | null>(null);
  const [isSettingsPanelOpen, setIsSettingsPanelOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"zones" | "device" | "schedule" | "programs" | "integrations" | "preferences">("zones");
  const [irrigationMode, setIrrigationMode] = useState<IrrigationMode>("smart");
  const [aiScheduleEnabled, setAiScheduleEnabled] = useState(false);
  const [lastAIRun, setLastAIRun] = useState<ScheduleRun | null>(null);
  const [lastAIRunEntries, setLastAIRunEntries] = useState<ScheduleEntry[]>([]);
  const [aiRunExpanded, setAiRunExpanded] = useState(false);
  const [aiRunRefreshKey, setAiRunRefreshKey] = useState(0);
  const [dashboardRunningAI, setDashboardRunningAI] = useState(false);

  const activeRefreshIdRef = useRef<number | null>(null);
  const refreshCompletionTimeoutRef = useRef<number | null>(null);
  const hasForecastRef = useRef(false);
  const lastDeviceConfigRef = useRef<DeviceConfig | null>(null);

  useEffect(() => {
    hasForecastRef.current = forecast !== null;
  }, [forecast]);

  useEffect(() => {
    if (deviceConfig) {
      lastDeviceConfigRef.current = deviceConfig;
    }
  }, [deviceConfig]);

  const historyFiltersRef = useRef<HTMLDivElement | null>(null);
  const realtimeEventHandlerRef = useRef<(event: RealtimeEvent) => void>(() => { });

  const loadStatus = useCallback(
    async (shouldAbort?: () => boolean) => {
      try {
        const current = await fetchStatus();
        if (shouldAbort?.()) {
          return;
        }
        setStatus(current);
      } catch (err) {
        if (shouldAbort?.()) {
          return;
        }
        console.error(err);
      }
    },
    []
  );

  const loadHeartbeats = useCallback(
    async (showLoading: boolean, shouldAbort?: () => boolean) => {
      if (showLoading) {
        if (shouldAbort?.()) {
          return;
        }
        setLoadState("loading");
        setError(null);
        setOverviewLoading(true);
        setOverviewError(null);
      }

      const startIso = toQueryDateTime(startDate);
      const endIso = toQueryDateTime(endDate);

      try {
        const [pageResponse, seriesResponse, overviewResponse] = await Promise.all([
          fetchHeartbeats({
            start: startIso,
            end: endIso,
            page,
            pageSize: HEARTBEAT_PAGE_SIZE
          }),
          fetchHeartbeatSeries({
            start: startIso,
            end: endIso,
            limit: HEARTBEAT_SERIES_LIMIT
          }),
          fetchHeartbeatOverview({
            start: startIso,
            end: endIso
          })
        ]);

        if (shouldAbort?.()) {
          return;
        }

        if (pageResponse.meta.totalPages > 0 && page > pageResponse.meta.totalPages) {
          setOverviewLoading(false);
          setLoadState("ready");
          setPage(pageResponse.meta.totalPages);
          return;
        }

        setHeartbeatPage(pageResponse.data);
        setHeartbeatMeta(pageResponse.meta);
        setHeartbeatSeries(seriesResponse);
        if (pageResponse.data.length > 0) {
          setLatestHeartbeatSnapshot((prev) => {
            if (pageResponse.meta.page === 1) {
              return pageResponse.data[0];
            }
            return prev ?? pageResponse.data[0];
          });
        } else if (pageResponse.meta.page === 1) {
          setLatestHeartbeatSnapshot(null);
        }
        setOverviewStats(overviewResponse);
        setOverviewError(null);
        setError(null);
        setLoadState("ready");
      } catch (err) {
        if (shouldAbort?.()) {
          return;
        }
        console.error(err);
        const message = err instanceof Error ? err.message : "Unable to load heartbeats";
        setError(message);
        setLoadState(showLoading ? "error" : "ready");
        setOverviewError(err instanceof Error ? err.message : "Unable to load heartbeat overview");
      } finally {
        if (!shouldAbort?.()) {
          setOverviewLoading(false);
        }
      }
    },
    [startDate, endDate, page]
  );

  const loadIrrigationEvents = useCallback(
    async (showLoading: boolean, shouldAbort?: () => boolean) => {
      if (showLoading) {
        setIrrigationLoading(true);
        setIrrigationError(null);
      }

      const startIso = toQueryDateTime(startDate);
      const endIso = toQueryDateTime(endDate);

      try {
        const response = await fetchIrrigationEvents({
          start: startIso,
          end: endIso,
          page: 1,
          pageSize: 500
        });
        if (shouldAbort?.()) {
          return;
        }
        setIrrigationEvents(response.events);
        setIrrigationMeta(response.meta);
      } catch (err) {
        if (shouldAbort?.()) {
          return;
        }
        console.error(err);
        setIrrigationError(err instanceof Error ? err.message : "Unable to load irrigation events");
      } finally {
        if (!shouldAbort?.()) {
          setIrrigationLoading(false);
        }
      }
    },
    [endDate, startDate]
  );

  const loadIrrigationRecords = useCallback(
    async () => {
      try {
        const records = await fetchLatestIrrigationPerZone();
        setIrrigationRecords(records);
      } catch (err) {
        console.error("Failed to load irrigation records:", err);
      }
    },
    []
  );

  const loadForecastData = useCallback(
    async (showLoading: boolean, shouldAbort?: () => boolean) => {
      const shouldShowLoading = showLoading && !hasForecastRef.current;
      if (showLoading) {
        setForecastError(null);
      }
      if (shouldShowLoading) {
        if (shouldAbort?.()) {
          return;
        }
        setForecastLoading(true);
      }

      try {
        const data = await fetchWeatherForecast();
        if (shouldAbort?.()) {
          return;
        }
        setForecast(data);
        setForecastError(null);
      } catch (err) {
        if (shouldAbort?.()) {
          return;
        }
        console.error(err);
        setForecastError(err instanceof Error ? err.message : "Unable to load forecast");
        return false;
      } finally {
        if (shouldShowLoading && !shouldAbort?.()) {
          setForecastLoading(false);
        }
      }
    },
    []
  );

  const loadDeviceConfig = useCallback(async () => {
    setDeviceConfigLoading(true);
    try {
      const config = await fetchDeviceConfig();
      setDeviceConfig(config ?? null);
    } catch (error) {
      console.error("Failed to fetch device config:", error);
    } finally {
      setDeviceConfigLoading(false);
    }
  }, []);

  const loadZones = useCallback(async () => {
    setZonesLoading(true);
    try {
      const [zoneList, states] = await Promise.all([fetchZones(), fetchZoneStates()]);
      setZones(zoneList);
      const stateMap: Record<string, ZoneState> = {};
      states.forEach((s) => { stateMap[s.zoneId] = s; });
      setZoneStates(stateMap);
    } catch (err) {
      console.error("Failed to load zones:", err);
    } finally {
      setZonesLoading(false);
    }
  }, []);

  const loadManualRunStatus = useCallback(async () => {
    try {
      const status = await getManualRunStatus();
      setManualRun(status);
    } catch { /* ignore */ }
  }, []);

  const loadSystemConfig = useCallback(async () => {
    try {
      const config = await fetchSystemConfig();
      setIrrigationMode(config.irrigationMode);
    } catch (err) {
      console.error("Failed to load system config:", err);
    }
  }, []);

  const loadAIScheduleEnabled = useCallback(async () => {
    try {
      const config = await fetchAIScheduleConfig();
      setAiScheduleEnabled(config?.enabled ?? false);
    } catch {
      setAiScheduleEnabled(false);
    }
  }, []);

  const loadLastAIRun = useCallback(async () => {
    try {
      const runsResult = await fetchScheduleRuns(1);
      const runs = runsResult?.data;
      if (runs && runs.length > 0) {
        const run = runs[0]!;
        setLastAIRun(run);
        try {
          const detail = await fetchScheduleRun(run.scheduleRunId);
          setLastAIRunEntries(Array.isArray(detail.entries) ? detail.entries : []);
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }, []);

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

  const integrationHealth = useIntegrationHealth({
    realtimeStatus,
    isRealtimeActive,
    forecastError,
    hasForecast: forecast !== null
  });

  const forceHearbeat = useCallback(async () => {
    setDeviceConfigLoading(true);
    try {
      const baseConfig = deviceConfig ?? lastDeviceConfigRef.current ?? undefined;
      const config = await updateDeviceConfig({
        ...(baseConfig ?? {}),
        forceHeartbeat: true
      });
      setDeviceConfig(config ?? null);
      return true;
    } catch (error) {
      console.error("Failed to force a heartBeat:", error);
      return false;
    } finally {
      setDeviceConfigLoading(false);
    }
  }, [deviceConfig]);

  const handleDeviceConfigSave = useCallback(async (config: DeviceConfig) => {
    const updated = await updateDeviceConfig(config);
    if (updated) {
      setDeviceConfig(updated);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let id: number | null = null;

    const tick = async () => {
      await loadStatus(() => cancelled);
      if (!cancelled && !isRealtimeActive) {
        setNextStatusRefreshAt(Date.now() + STATUS_REFRESH_MS);
      }
    };

    void tick();

    if (isRealtimeActive) {
      setNextStatusRefreshAt(null);
    }

    if (!isRealtimeActive) {
      id = window.setInterval(() => {
        void tick();
      }, STATUS_REFRESH_MS);
    }

    return () => {
      cancelled = true;
      if (id !== null) {
        window.clearInterval(id);
      }
    };
  }, [isRealtimeActive, loadStatus]);

  useEffect(() => {
    let cancelled = false;
    let refreshId: number | null = null;

    const tick = async (showLoading: boolean) => {
      await Promise.all([
        loadHeartbeats(showLoading, () => cancelled),
        loadIrrigationEvents(showLoading, () => cancelled),
        loadIrrigationRecords()
      ]);
      if (!cancelled && !isRealtimeActive) {
        setNextHeartbeatRefreshAt(Date.now() + HEARTBEAT_REFRESH_MS);
      }
    };

    void tick(true);

    if (isRealtimeActive) {
      setNextHeartbeatRefreshAt(null);
    }

    if (!isRealtimeActive) {
      refreshId = window.setInterval(() => {
        void tick(false);
      }, HEARTBEAT_REFRESH_MS);
    }

    return () => {
      cancelled = true;
      if (refreshId !== null) {
        window.clearInterval(refreshId);
      }
    };
  }, [isRealtimeActive, loadHeartbeats, loadIrrigationEvents, loadIrrigationRecords]);

  useEffect(() => {
    let cancelled = false;
    let refreshId = 0;

    const tick = async (showLoading: boolean) => {
      await loadForecastData(showLoading, () => cancelled);
    };

    const scheduleNextRefresh = () => {
      const msPerHour = 60 * 60 * 1000;
      const delay = msPerHour - (Date.now() % msPerHour);
      const nextRefreshAt = Date.now() + delay;
      setNextForecastRefreshAt(nextRefreshAt);
      refreshId = window.setTimeout(() => {
        void tick(false);
        if (!cancelled) {
          scheduleNextRefresh();
        }
      }, delay);
    };

    const shouldFetchNow =
      !forecast ||
      !forecast.expiresAt ||
      Date.now() > Date.parse(forecast.expiresAt ?? "");

    if (shouldFetchNow) {
      void tick(true);
    }

    if (!isRealtimeActive) {
      scheduleNextRefresh();
    } else {
      setNextForecastRefreshAt(null);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(refreshId);
    };
  }, [forecast, isRealtimeActive, loadForecastData, newForecastPushedAt]);

  useEffect(() => {
    if (deviceConfig) {
      return;
    }
    let cancelled = false;
    void loadDeviceConfig();
    const id = window.setInterval(() => {
      if (!cancelled) {
        void loadDeviceConfig();
      }
    }, DEVICE_CONFIG_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [deviceConfig, loadDeviceConfig]);


  useEffect(() => {
    void loadZones();
    void loadManualRunStatus();
  }, [loadZones, loadManualRunStatus]);

  useEffect(() => {
    void loadSystemConfig();
    void loadAIScheduleEnabled();
    void loadLastAIRun();
  }, [loadSystemConfig, loadAIScheduleEnabled, loadLastAIRun]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate]);

  const trendData = useMemo(
    () =>
      [...heartbeatSeries]
        .sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        .map((sample) => ({
          timestamp: sample.timestamp,
          psi: sample.psi
        })),
    [heartbeatSeries]
  );

  const guardActive = status?.guard ?? latestHeartbeatSnapshot?.guard ?? false;

  const currentWeather = useMemo((): WeatherConditionsSnapshot | null => {
    if (forecast) {
      return {
        locationName: forecast.locationName,
        fetchedAt: forecast.fetchedAt,
        expiresAt: forecast.expiresAt ?? new Date(Date.now() + 3600000).toISOString(),
        periodStart: forecast.periodStart ?? null,
        periodEnd: forecast.periodEnd ?? null,
        temperature: forecast.temperature ?? null,
        temperatureUnit: forecast.temperatureUnit ?? null,
        precipitationProbability: forecast.precipitationProbability ?? null,
        isDaytime: forecast.isDaytime ?? null,
        shortForecast: forecast.shortForecast ?? null
      };
    }
    return null;
  }, [status, latestHeartbeatSnapshot, forecast]);

  const connectedSensors = useMemo(
    () =>
      Array.from(
        new Set(
          status?.device.connectedSensors ??
          latestHeartbeatSnapshot?.device.connectedSensors ??
          []
        )
      ),
    [status, latestHeartbeatSnapshot]
  );

  const lastUpdate =
    status?.lastUpdatedAt ??
    latestHeartbeatSnapshot?.timestamp ??
    new Date().toISOString();

  const hasHeartbeatData = Boolean(status || latestHeartbeatSnapshot);
  const lastHeartbeatText = hasHeartbeatData
    ? formatTimestamp(lastUpdate)
    : "—";

  const latestWaterPsi =
    status?.sensors?.waterPsi ?? latestHeartbeatSnapshot?.sensors.waterPsi;
  const latestTempF = status?.device?.tempF ?? latestHeartbeatSnapshot?.device.tempF;
  const latestHumidity =
    status?.device?.humidity ?? latestHeartbeatSnapshot?.device.humidity;
  const latestBaselinePsi =
    status?.device?.baselinePsi ?? latestHeartbeatSnapshot?.device.baselinePsi;

  const latestIp = status?.device?.ip ?? latestHeartbeatSnapshot?.device.ip;

  const rainStatus = connectedSensors.includes("RAIN") ? (
    status ? status.sensors.rain
      ? "Detected"
      : "No"
      : latestHeartbeatSnapshot
        ? latestHeartbeatSnapshot.sensors.rain
          ? "Detected"
          : "No"
        : "No data")
    : "Ignored";

  const rainStatusTone: StatusTone = connectedSensors.includes("RAIN") ? (
    status ? status.sensors.rain
      ? "negative"
      : "positive"
      : latestHeartbeatSnapshot
        ? latestHeartbeatSnapshot.sensors.rain
          ? "negative"
          : "positive"
        : "informative")
    : "warning";

  const soilStatus = connectedSensors.includes("SOIL") ? (
    status
      ? status.sensors.soil
        ? "Saturated"
        : "Dry"
      : latestHeartbeatSnapshot
        ? latestHeartbeatSnapshot.sensors.soil
          ? "Saturated"
          : "Dry"
        : "No data")
    : "Ignored";

  const soilStatusTone: StatusTone = connectedSensors.includes("SOIL") ? (
    status
      ? status.sensors.soil
        ? "negative"
        : "positive"
      : latestHeartbeatSnapshot
        ? latestHeartbeatSnapshot.sensors.soil
          ? "negative"
          : "positive"
        : "informative")
    : "warning";

  const fallbackGuardChange = useMemo(
    () =>
      getLastChangeTimestamp(
        heartbeatPage,
        (heartbeat) => heartbeat.guard
      ),
    [heartbeatPage]
  );

  const fallbackRainChange = useMemo(
    () =>
      getLastChangeTimestamp(
        heartbeatPage,
        (heartbeat) => heartbeat.sensors.rain
      ),
    [heartbeatPage]
  );

  const fallbackSoilChange = useMemo(
    () =>
      getLastChangeTimestamp(
        heartbeatPage,
        (heartbeat) => heartbeat.sensors.soil
      ),
    [heartbeatPage]
  );

  const fallbackPressureChange = useMemo(
    () =>
      getLastChangeTimestamp(
        heartbeatPage,
        (heartbeat) => heartbeat.sensors.waterPsi,
        (a, b) => Math.abs(a - b) < 0.1
      ),
    [heartbeatPage]
  );

  const statusIrrigation = useMemo(() => {
    const irrigation = status?.irrigation;
    if (!irrigation) return null;
    return {
      zone: irrigation.zone,
      action: irrigation.action ?? null
    };
  }, [status]);

  const lastIrrigationChange = useMemo(() => {
    const statusTs = status?.changes?.irrigation ?? null;
    const parsed = statusTs ? Date.parse(statusTs) : null;
    return parsed && Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }, [status]);

  const lastGuardChange = status?.changes?.guard ?? fallbackGuardChange;
  const lastRainChange = connectedSensors.includes("RAIN") ? (status?.changes?.sensors?.rain ?? fallbackRainChange) : null;
  const lastSoilChange = connectedSensors.includes("SOIL") ? (status?.changes?.sensors?.soil ?? fallbackSoilChange) : null;
  const lastPressureChange =
    status?.changes?.sensors?.waterPsi ?? fallbackPressureChange;


  const precipitationSeries = useMemo<PrecipitationPoint[]>(() => {
    if (!forecast) {
      return [];
    }
    const now = Date.now();
    return forecast.precipitationOutlook
      .filter((entry) => new Date(entry.periodStart).getTime() >= now)
      .map((entry) => ({
        timestamp: entry.periodStart,
        probability: entry.probability ?? 0
      }));
  }, [forecast]);

  const { overviewCards, pressureOverview } = useMemo(() => {
    if (!overviewStats) {
      return {
        overviewCards: [] as OverviewCardDefinition[],
        pressureOverview: null as OverviewCardDefinition | null
      };
    }

    const guardTotal = overviewStats.guard.activeMs + overviewStats.guard.inactiveMs;
    const rainTotal = overviewStats.rainDays.positive + overviewStats.rainDays.negative;
    const soilTotal = overviewStats.soilDays.positive + overviewStats.soilDays.negative;
    const pressureTotal =
      overviewStats.pressure.activeMs + overviewStats.pressure.inactiveMs;

    const cards: OverviewCardDefinition[] = [
      {
        key: "guard",
        title: "Guard status time",
        unit: "duration",
        unitLabel: "minute",
        total: guardTotal,
        data: [
          {
            key: "guard-active",
            name: "Guard active",
            value: overviewStats.guard.activeMs,
            color: "#ef4444"
          },
          {
            key: "guard-ready",
            name: "Guard ready",
            value: overviewStats.guard.inactiveMs,
            color: "#10b981"
          }
        ]
      },
      {
        key: "rain",
        title: "Rain detected",
        unit: "count",
        unitLabel: "day",
        total: rainTotal,
        data: [
          {
            key: "rainy",
            name: "Rainy",
            value: overviewStats.rainDays.positive,
            color: "#3b82f6"
          },
          {
            key: "clear",
            name: "Dry",
            value: overviewStats.rainDays.negative,
            color: "#94a3b8"
          }
        ]
      },
      {
        key: "soil",
        title: "Soil moisture",
        unit: "count",
        unitLabel: "day",
        total: soilTotal,
        data: [
          {
            key: "saturated",
            name: "Saturated",
            value: overviewStats.soilDays.positive,
            color: "#22c55e"
          },
          {
            key: "dry",
            name: "Dry",
            value: overviewStats.soilDays.negative,
            color: "#f59e0b"
          }
        ]
      },
      {
        key: "pressure",
        title: "Water Press",
        unit: "duration",
        unitLabel: "minute",
        total: pressureTotal,
        data: [
          {
            key: "above",
            name: "Above baseline",
            value: overviewStats.pressure.activeMs,
            color: "#6366f1"
          },
          {
            key: "below",
            name: "At or below",
            value: overviewStats.pressure.inactiveMs,
            color: "#a5b4fc"
          }
        ]
      }
    ];

    return {
      overviewCards: cards.filter((card) => card.key !== "pressure"),
      pressureOverview: cards.find((card) => card.key === "pressure") ?? null
    };
  }, [overviewStats]);

  const filterActive = useMemo(
    () => Boolean(startDate || endDate),
    [startDate, endDate]
  );

  const filterSummary = useMemo(() => {
    if (!filterActive) {
      return "Showing entire history";
    }
    const startLabel = startDate
      ? format(startDate, "MMM d • h:mm a")
      : "Beginning";
    const endLabel = endDate
      ? format(endDate, "MMM d • h:mm a")
      : "Now";
    return `${startLabel} – ${endLabel}`;
  }, [filterActive, startDate, endDate]);

  const overviewSubtitle = useMemo(() => {
    if (filterSummary === "Showing entire history") {
      return "the entire history";
    }
    return filterSummary;
  }, [filterSummary]);

  const nextAutoRefreshAt = useMemo(() => {
    const candidates = [
      nextStatusRefreshAt,
      nextHeartbeatRefreshAt,
      nextForecastRefreshAt
    ].filter((value): value is number => typeof value === "number");

    if (candidates.length === 0) {
      return null;
    }

    return Math.min(...candidates);
  }, [nextStatusRefreshAt, nextHeartbeatRefreshAt, nextForecastRefreshAt]);

  const clearRefreshCompletionTimer = useCallback(() => {
    if (refreshCompletionTimeoutRef.current) {
      window.clearTimeout(refreshCompletionTimeoutRef.current);
      refreshCompletionTimeoutRef.current = null;
    }
  }, []);

  const scheduleRefreshMarkers = useCallback(() => {
    const nowTs = Date.now();
    setNextStatusRefreshAt(nowTs + STATUS_REFRESH_MS);
    setNextHeartbeatRefreshAt(nowTs + HEARTBEAT_REFRESH_MS);
    setNextForecastRefreshAt(nowTs + FORECAST_REFRESH_MS);
    setNextDeviceConfigRefreshAt(nowTs + DEVICE_CONFIG_REFRESH_MS);
  }, []);

  const markRefreshSuccess = useCallback(() => {
    scheduleRefreshMarkers();
    clearRefreshCompletionTimer();
    setRefreshPhase("success");
    deactivateManualSession();
    refreshCompletionTimeoutRef.current = window.setTimeout(() => {
      setRefreshPhase("idle");
      refreshCompletionTimeoutRef.current = null;
    }, REFRESH_SUCCESS_RESET_MS);
  }, [clearRefreshCompletionTimer, scheduleRefreshMarkers, deactivateManualSession]);

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
  }, []);

  const handleStartDateChange = useCallback(
    (value: Date | null) => {
      setStartDate(value);
      if (value && endDate && value > endDate) {
        setEndDate(null);
      }
    },
    [endDate]
  );

  const handleEndDateChange = useCallback((value: Date | null) => {
    setEndDate(value);
  }, []);

  const toggleSettingsPanel = useCallback(() => {
    setIsSettingsPanelOpen((prev) => !prev);
  }, []);

  const handleDashboardRunAI = useCallback(async () => {
    setDashboardRunningAI(true);
    try {
      await triggerAIScheduleRun();
    } catch {
      setDashboardRunningAI(false);
    }
  }, []);

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
      const tasks = await Promise.all([
        loadStatus(),
        loadHeartbeats(true),
        loadIrrigationEvents(true),
        loadIrrigationRecords(),
        loadForecastData(true),
        forceHearbeat()
      ]);
      scheduleRefreshMarkers();
      tasks.some((value) => value === false)
        ? markRefreshError()
        : setRefreshPhase("waiting-device");
    } catch (error) {
      console.error("Failed to trigger refresh:", error);
      markRefreshError();
    }
  }, [
    isRefreshAnimating,
    activateManualSession,
    resetRealtimeBackoff,
    clearRefreshCompletionTimer,
    loadStatus,
    loadHeartbeats,
    loadIrrigationEvents,
    loadIrrigationRecords,
    loadForecastData,
    forceHearbeat,
    scheduleRefreshMarkers,
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
          loadStatus(),
          loadHeartbeats(false),
          loadIrrigationEvents(false),
          loadIrrigationRecords(),
          loadForecastData(false)
        ]);
        if (shouldMarkRefresh) {
          markRefreshSuccess();
        } else {
          scheduleRefreshMarkers();
        }
      } catch (error) {
        console.error("Failed to synchronise after heartbeat:", error);
        if (shouldMarkRefresh) {
          markRefreshError();
        }
      }
    },
    [
      loadStatus,
      loadHeartbeats,
      loadIrrigationEvents,
      loadIrrigationRecords,
      loadForecastData,
      markRefreshSuccess,
      markRefreshError,
      scheduleRefreshMarkers
    ]
  );

  const handleRealtimeEvent = useCallback(
    (event: RealtimeEvent) => {
      switch (event.type) {
        case "forceHeartbeat:queued": {
          if (activeRefreshIdRef.current !== null) {
            setRefreshPhase("waiting-device");
          }
          break;
        }
        case "forceHeartbeat:acknowledged": {
          void loadDeviceConfig();
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
          if (event?.payload) setForecast(event?.payload);
          setNewForecastPushedAt(Date.now());
          break;
        }
        case "status:updated": {
          void loadStatus();
          break;
        }
        case "irrigation:updated": {
          void loadIrrigationEvents(false);
          void loadIrrigationRecords();
          void loadZones();
          void loadStatus();
          break;
        }
        case "deviceConfig:updated": {
          if (event.payload) {
            setDeviceConfig(event.payload);
          } else {
            void loadDeviceConfig();
          }
          break;
        }
        case "zone:created":
        case "zone:updated":
        case "zone:deleted":
        case "command:created":
        case "command:updated":
        case "zoneState:changed": {
          void loadZones();
          break;
        }
        case "schedule:runCompleted": {
          void loadLastAIRun();
          void loadAIScheduleEnabled();
          void loadZones();
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
            setManualRun(event.payload as SequentialRun);
          }
          if (event.type === "sequentialRun:completed" || event.type === "sequentialRun:cancelled") {
            void loadZones();
          }
          break;
        }
        case "deferral:triggered":
        case "deferral:recovered":
        case "deferral:expired": {
          void loadZones();
          setAiRunRefreshKey((k) => k + 1);
          break;
        }
        default:
          break;
      }
  },
  [loadDeviceConfig, loadIrrigationEvents, loadIrrigationRecords, loadStatus, syncDataAfterHeartbeat, loadZones, loadLastAIRun, loadAIScheduleEnabled]
  );

  useEffect(() => {
    realtimeEventHandlerRef.current = handleRealtimeEvent;
  }, [handleRealtimeEvent]);

  useEffect(() => {
    return () => {
      clearRefreshCompletionTimer();
    };
  }, [clearRefreshCompletionTimer]);

  const formatMetric = (value?: number) =>
    value === undefined || Number.isNaN(value) ? "—" : value.toFixed(1);

  const waterPressureMeta = useMemo(() => {
    if (latestWaterPsi === undefined) {
      return {
        status: "No data",
        tone: "informative" as const,
        detail:
          latestBaselinePsi !== undefined
            ? `Baseline ${latestBaselinePsi.toFixed(1)} psi`
            : undefined
      };
    }

    if (latestBaselinePsi === undefined) {
      return {
        status: `${formatMetric(latestWaterPsi)} psi`,
        tone: "informative" as const,
        detail: undefined
      };
    }

    const tone: "positive" | "negative" =
      latestWaterPsi >= latestBaselinePsi ? "positive" : "negative";

    return {
      status: `${formatMetric(latestWaterPsi)} psi`,
      tone,
      detail: `Baseline ${latestBaselinePsi.toFixed(1)} psi`
    };
  }, [latestWaterPsi, latestBaselinePsi]);


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
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 014 4c0 1.95-1.4 3.59-3.25 3.93" /><path d="M12 2a4 4 0 00-4 4c0 1.95 1.4 3.59 3.25 3.93" /><path d="M12 10v4" /><path d="M8 18h8" /><path d="M9 22h6" /><path d="M12 14v4" /></svg>
        </NavLink>
        <NavLink to="/logs" className={({ isActive }) => `app-nav__link${isActive ? " app-nav__link--active" : ""}`} title="Logs">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
        </NavLink>
      </nav>

      <Routes>
        <Route path="/" element={
          <>
            {error ? <div className="error-banner">{error}</div> : null}

            <WeatherWidget
        loading={forecastLoading}
        error={forecastError}
        currentWeather={currentWeather}
        fallbackLocation={forecast?.locationName ?? null}
        fallbackUpdatedAt={forecast?.fetchedAt ?? null}
        precipitationSeries={precipitationSeries}
      />

      <StatusPanel
        guard={guardActive}
        irrigation={statusIrrigation}
        lastIrrigationChange={lastIrrigationChange}
        zones={zones}
        pressureStatus={waterPressureMeta.status}
        pressureTone={waterPressureMeta.tone}
        pressureDetail={waterPressureMeta.detail}
        pressureActive={connectedSensors.includes("PRESSURE")}
        rainStatus={rainStatus}
        rainTone={rainStatusTone}
        rainActive={connectedSensors.includes("RAIN")}
        soilStatus={soilStatus}
        soilTone={soilStatusTone}
        soilActive={connectedSensors.includes("SOIL")}
      />

      <ZoneControlPanel
        zones={zones}
        zoneStates={zoneStates}
        loading={zonesLoading}
        onZonesChanged={loadZones}
        mode="control"
        onOpenSettings={() => { setSettingsTab("zones"); setIsSettingsPanelOpen(true); }}
        irrigationRecords={irrigationRecords}
        baselinePsi={latestBaselinePsi}
        manualRun={manualRun}
        guardActive={guardActive}
      />

      <IrrigationQueuePanel
        zones={zones}
        irrigationMode={irrigationMode}
        aiScheduleEnabled={aiScheduleEnabled}
        refreshKey={aiRunRefreshKey}
        onModeChanged={(mode) => setIrrigationMode(mode)}
        onScheduleChanged={loadZones}
        onOpenSmartSettings={() => { setSettingsTab("schedule"); setIsSettingsPanelOpen(true); }}
        onOpenProgramSettings={() => { setSettingsTab("programs"); setIsSettingsPanelOpen(true); }}
      />

      <section className="ai-run-summary">
        <div className="ai-run-summary__top-row">
          {lastAIRun && (
            <button
              type="button"
              className="ai-run-summary__header"
              onClick={() => setAiRunExpanded((v) => !v)}
            >
              <h3>Last AI Evaluation</h3>
              <span className={`schedule-status-pill schedule-status-pill--${lastAIRun.status}`}>
                {lastAIRun.status}
              </span>
              <span className="ai-run-summary__time">
                {new Date(lastAIRun.startedAt).toLocaleString("en-US", {
                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true
                })}
              </span>
              <span className="muted" style={{ fontSize: "var(--text-xs)" }}>
                {lastAIRun.triggeredBy === "cron" ? "auto" : "manual"}
                {typeof lastAIRun.entries === "number" && lastAIRun.entries > 0
                  ? ` · ${lastAIRun.entries} zone${lastAIRun.entries !== 1 ? "s" : ""}`
                  : ""}
              </span>
            </button>
          )}
          {!lastAIRun && <h3 style={{ margin: 0 }}>AI Evaluation</h3>}
          {aiScheduleEnabled && (
            <button
              type="button"
              className={`icon-btn ai-run-status-btn ai-run-status-btn--${dashboardRunningAI ? "running" : lastAIRun?.status === "completed" ? "success" : lastAIRun?.status ?? "none"}`}
              disabled={dashboardRunningAI}
              onClick={handleDashboardRunAI}
              title={dashboardRunningAI ? "Running..." : "Run AI evaluation"}
              aria-label={dashboardRunningAI ? "Running..." : "Run AI evaluation"}
            >
              {dashboardRunningAI ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              )}
            </button>
          )}
        </div>
        {lastAIRun && aiRunExpanded && (
          <div className="ai-run-summary__body">
            {lastAIRun.reasoning && (
              <p className="ai-run-summary__reasoning">{lastAIRun.reasoning}</p>
            )}
            {lastAIRun.errorMessage && (
              <p className="ai-run-summary__error">{lastAIRun.errorMessage}</p>
            )}
            {lastAIRunEntries.length > 0 && (
              <div className="ai-run-summary__entries">
                {lastAIRunEntries.map((entry) => {
                  const zone = zones.find((z) => z.zoneId === entry.zoneId);
                  return (
                    <div className="ai-run-summary__entry" key={entry._id}>
                      <span className="ai-run-summary__zone-name">{zone?.name ?? entry.zoneId}</span>
                      <span className="ai-run-summary__zone-dur">{entry.plannedDurationMinutes} min</span>
                      <span className="ai-run-summary__zone-time">
                        {new Date(entry.plannedStartAt).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="history-window">
        <article className="history-window-card">
          <header className="history-window-header">
            <div>
              <h3>History window</h3>
              <p className="muted">{filterSummary}</p>
            </div>
          </header>
          <div className="history-window-filters" ref={historyFiltersRef}>
            <div className="records-filters__row">
              <div className="time-filter-field">
                <label htmlFor="history-start">From</label>
                <DateTimeInput
                  value={startDate}
                  onChange={handleStartDateChange}
                  max={endDate ?? new Date()}
                  placeholder="Beginning of time"
                  clearable
                />
              </div>
              <div className="time-filter-field">
                <label htmlFor="history-end">To</label>
                <DateTimeInput
                  value={endDate}
                  onChange={handleEndDateChange}
                  min={startDate ?? undefined}
                  max={new Date()}
                  placeholder="Now"
                  clearable
                />
              </div>
            </div>
            {filterActive && (
              <button
                type="button"
                className="history-filter-reset"
                onClick={handleResetFilters}
                title="Reset filters"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </div>
          <div className="history-window-section" aria-label="Analytics">
            <OverviewSection
              cards={overviewCards}
              pressureOverview={pressureOverview}
              trendData={trendData}
              latestBaselinePsi={latestBaselinePsi}
              subtitle={overviewSubtitle}
              loading={overviewLoading}
              error={overviewError}
            />
          </div>
        </article>
      </section>
          </>
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
        aiRunRefreshKey={aiRunRefreshKey}
      />
    </main>
  );
};

export default App;
