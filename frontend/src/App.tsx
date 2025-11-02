import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import ReactDatePicker from "react-datepicker";
import {
  buildRealtimeUrl,
  fetchDeviceConfig,
  updateDeviceConfig,
  fetchHeartbeatOverview,
  fetchHeartbeats,
  fetchHeartbeatSeries,
  fetchIrrigationEvents,
  fetchStatus,
  fetchWeatherForecast
} from "./api";
import type {
  DeviceConfig,
  Heartbeat,
  HeartbeatListMeta,
  HeartbeatOverviewStats,
  HeartbeatSeriesSample,
  IrrigationEvent,
  StatusPayload,
  WeatherOverviewPayload,
  WeatherConditionsSnapshot,
  RealtimeEvent
} from "./types";
import "react-datepicker/dist/react-datepicker.css";
import "./modal.css";
import WeatherWidget, { type PrecipitationPoint } from "./components/WeatherWidget";
import DeviceWidget from "./components/DeviceWidget";
import IrrigationWidget from "./components/IrrigationWidget";
import OverviewSection, {
  type OverviewCardDefinition
} from "./components/OverviewSection";
import HistorySection from "./components/HistorySection";
import { GuardCard } from "./components/status/GuardCard";
import {
  SensorWidget,
  type StatusTone
} from "./components/status/SensorWidgets";
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
  const [isStatusChipVisible, setIsStatusChipVisible] = useState(false);
  const [isDevicePanelOpen, setIsDevicePanelOpen] = useState(false);
  const scrollPositionRef = useRef<number | null>(null);
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
  const startPickerFieldRef = useRef<HTMLDivElement | null>(null);
  const endPickerFieldRef = useRef<HTMLDivElement | null>(null);
  const currentCalendarAnchorRef = useRef<HTMLElement | null>(null);
  const calendarPortalRef = useRef<HTMLDivElement | null>(null);
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

  const updateCalendarPortalPosition = useCallback((anchor?: HTMLElement | null) => {
    if (typeof window === "undefined") {
      return;
    }
    const portal = calendarPortalRef.current;
    const target =
      anchor ??
      currentCalendarAnchorRef.current ??
      startPickerFieldRef.current ??
      historyFiltersRef.current;
    const container = historyFiltersRef.current ?? target;
    if (!portal || !target || !container) {
      return;
    }
    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    portal.style.top = `${targetRect.bottom + window.scrollY}px`;
    portal.style.left = `${containerRect.left + window.scrollX}px`;
    portal.style.width = `${containerRect.width}px`;
  }, []);

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
        loadIrrigationEvents(showLoading, () => cancelled)
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
  }, [isRealtimeActive, loadHeartbeats, loadIrrigationEvents]);

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
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const totalPages = heartbeatMeta?.totalPages ?? 1;
  const totalHeartbeatCount = heartbeatMeta?.totalCount ?? heartbeatPage.length;
  const totalIrrigationCount = irrigationMeta?.totalCount ?? irrigationEvents.length;
  const hasNextPage = heartbeatMeta?.hasNextPage ?? page < totalPages;
  const hasPreviousPage = heartbeatMeta?.hasPreviousPage ?? page > 1;
  const pagedHeartbeats = heartbeatPage;
  const isHistoryLoading = loadState === "loading";
  const rememberScrollPosition = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    scrollPositionRef.current = window.scrollY;
  }, []);

  const restoreScrollPosition = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const storedScroll = scrollPositionRef.current;
    if (storedScroll === null) {
      return;
    }
    window.scrollTo({
      top: storedScroll
    });
    scrollPositionRef.current = null;
  }, []);

  useEffect(() => {
    if (!isHistoryLoading && scrollPositionRef.current !== null) {
      if (typeof window !== "undefined") {
        const frame = window.requestAnimationFrame(() => {
          restoreScrollPosition();
        });
        return () => window.cancelAnimationFrame(frame);
      }
      restoreScrollPosition();
    }
    return;
  }, [isHistoryLoading, restoreScrollPosition]);

  useEffect(() => {
    if (isHistoryLoading && scrollPositionRef.current !== null && typeof window !== "undefined") {
      window.scrollTo({
        top: scrollPositionRef.current
      });
    }
  }, [isHistoryLoading]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    let portal = document.getElementById("filter-calendar-portal") as HTMLDivElement | null;
    let created = false;
    if (!portal) {
      portal = document.createElement("div");
      portal.id = "filter-calendar-portal";
      created = true;
      document.body.appendChild(portal);
    }
    portal.classList.add("filter-calendar-portal");
    calendarPortalRef.current = portal;
    updateCalendarPortalPosition();
    return () => {
      if (portal) {
        portal.classList.remove("filter-calendar-portal");
        if (created && portal.parentElement) {
          portal.parentElement.removeChild(portal);
        }
      }
    };
  }, [updateCalendarPortalPosition]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleReposition = () => {
      updateCalendarPortalPosition();
    };
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, { passive: true });
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition);
    };
  }, [updateCalendarPortalPosition]);

  const handlePreviousPage = useCallback(() => {
    if (!hasPreviousPage) {
      return;
    }
    rememberScrollPosition();
    setPage((prev) => Math.max(1, prev - 1));
  }, [hasPreviousPage, rememberScrollPosition]);

  const handleNextPage = useCallback(() => {
    if (!hasNextPage) {
      return;
    }
    rememberScrollPosition();
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [hasNextPage, rememberScrollPosition, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [startDate, endDate]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

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

  const lastUpdateAt = useMemo(() => {
    const parseTs = (value: string | null | undefined) => {
      if (!value) return null;
      const ts = Date.parse(value);
      return Number.isFinite(ts) ? ts : null;
    };
    if (status?.lastUpdatedAt) {
      const parsed = parseTs(status.lastUpdatedAt);
      if (parsed) {
        return new Date(parsed).toISOString();
      }
    }
    const candidates = [
      parseTs(lastGuardChange),
      parseTs(latestHeartbeatSnapshot?.timestamp ?? null),
      parseTs(lastIrrigationChange)
    ].filter((ts): ts is number => ts !== null);

    if (candidates.length === 0) {
      return null;
    }

    const maxTs = Math.max(...candidates);
    return new Date(maxTs).toISOString();
  }, [lastGuardChange, status?.lastUpdatedAt, latestHeartbeatSnapshot, lastIrrigationChange]);

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
        if (!isRealtimeActive) {
          return null;
        }
        if (realtimeStatus === "connecting") {
          return { key: "connecting", label: "Connecting live updates…" };
        }
        if (realtimeStatus === "disconnected") {
          return { key: "disconnected", label: "Realtime channel offline" };
        }
        if (realtimeStatus === "connected") {
          return { key: "ready", label: "Live updates ready" };
        }
        return null;
    }
  }, [refreshPhase, realtimeStatus, isRealtimeActive]);

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

  const toggleDevicePanel = useCallback(() => {
    setIsDevicePanelOpen((prev) => !prev);
  }, []);

  const handleCalendarOpen = useCallback(
    (anchor?: HTMLElement | null) => {
      if (anchor) {
        currentCalendarAnchorRef.current = anchor;
      }
      updateCalendarPortalPosition(anchor);
    },
    [updateCalendarPortalPosition]
  );

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
        default:
          break;
      }
  },
  [loadDeviceConfig, loadIrrigationEvents, loadStatus, syncDataAfterHeartbeat]
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

  useEffect(() => {
    if (!refreshStatusDisplay) {
      setIsStatusChipVisible(false);
      return;
    }
    if (typeof window === "undefined") {
      setIsStatusChipVisible(true);
      return;
    }
    const timer = window.setTimeout(() => {
      setIsStatusChipVisible(true);
    }, 0);
    return () => {
      if (typeof window !== "undefined") {
        window.clearTimeout(timer);
      }
      setIsStatusChipVisible(false);
    };
  }, [refreshStatusDisplay]);

  return (
    <main className="app">
      <header className="app-header">
        <img
          src="banner.png"
          alt="Irrigation Monitor Logo"
          className="app-logo"
        />
        <div className="app-header-actions">
          <div className={`app-header-actions-row${refreshStatusDisplay ? " app-header-actions-row--active" : ""}`}>
            {refreshStatusDisplay ? (
              <span className={`refresh-status-chip${isStatusChipVisible ? " refresh-status-chip--visible" : ""}`}>
                <RefreshStatusIcon
                  status={refreshStatusDisplay.key}
                  label={refreshStatusDisplay.label}
                />
              </span>
            ) : null}
            <button
              type="button"
              className="refresh-icon-button"
              onClick={() => {
                void handleForceRefresh();
              }}
              aria-label="Force refresh data"
            >
              <span className={`refresh-icon${isRefreshAnimating ? " spin" : ""}`}>
                <RefreshIcon />
              </span>
            </button>
            <button
              type="button"
              className="device-panel__hamburger"
              onClick={toggleDevicePanel}
              aria-label="Toggle device panel"
              aria-expanded={isDevicePanelOpen}
            >
              <span className="device-panel__hamburger-icon" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>

      </header>

      {error ? <div className="error-banner">⚠️ {error}</div> : null}

      <WeatherWidget
        loading={forecastLoading}
        error={forecastError}
        currentWeather={currentWeather}
        fallbackLocation={forecast?.locationName ?? null}
        fallbackUpdatedAt={forecast?.fetchedAt ?? null}
        precipitationSeries={precipitationSeries}
      />

      <section className="status-grid">
          <GuardCard
            guard={guardActive}
            lastChangeAt={lastUpdateAt}
            lastIrrigationChange={lastIrrigationChange}
            irrigation={statusIrrigation}
            now={now}
          />
        <SensorWidget
          title="Pressure"
          icon={getSensorIcon("pressure", "sensor-icon--pressure")}
          status={waterPressureMeta.status}
          statusTone={waterPressureMeta.tone}
          detail={waterPressureMeta.detail}
          active={connectedSensors.includes("PRESSURE")}
          lastChangedAt={lastPressureChange}
        />
        <SensorWidget
          title="Rain"
          icon={getSensorIcon("rain", "sensor-icon--rain")}
          status={rainStatus}
          statusTone={rainStatusTone}
          active={connectedSensors.includes("RAIN")}
          lastChangedAt={lastRainChange}
        />
        <SensorWidget
          title="Soil"
          icon={getSensorIcon("soil", "sensor-icon--soil")}
          status={soilStatus}
          statusTone={soilStatusTone}
          active={connectedSensors.includes("SOIL")}
          lastChangedAt={lastSoilChange}
        />
        <IrrigationWidget
          events={irrigationEvents}
          isLoading={irrigationLoading}
          totalCount={totalIrrigationCount}
          error={irrigationError}
          baselinePsi={latestBaselinePsi}
        />
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
            <h3>Filter</h3>
            <button
              type="button"
              className="time-filter-reset"
              onClick={handleResetFilters}
              disabled={!filterActive}
            >
              <span className="time-filter-reset-icon" aria-hidden="true">
                ↺
              </span>
              Reset
            </button>
            <div className="time-filter-field">
              <label htmlFor="history-start">From</label>
              <div
                className="datepicker-anchor"
                ref={startPickerFieldRef}
              >
                <ReactDatePicker
                  id="history-start"
                  selected={startDate}
                  onChange={(value: Date | null) => {
                    handleStartDateChange(value);
                  }}
                  selectsStart
                  startDate={startDate}
                  endDate={endDate}
                  maxDate={endDate ?? new Date()}
                  showTimeSelect
                  timeIntervals={15}
                  placeholderText="Beginning of time"
                  className="date-input"
                  calendarClassName="date-calendar"
                  dateFormat="MMM d, yyyy h:mm aa"
                  isClearable
                  withPortal
                  portalId="filter-calendar-portal"
                  onCalendarOpen={() => {
                    const anchor = (startPickerFieldRef.current
                      ?.querySelector(".react-datepicker__input-container") as HTMLElement | null) ??
                      startPickerFieldRef.current;
                    handleCalendarOpen(anchor ?? undefined);
                  }}
                />
              </div>
            </div>
            <div className="time-filter-field">
              <label htmlFor="history-end">To</label>
              <div
                className="datepicker-anchor"
                ref={endPickerFieldRef}
              >
                <ReactDatePicker
                  id="history-end"
                  selected={endDate}
                  onChange={(value: Date | null) => {
                    handleEndDateChange(value);
                  }}
                  selectsEnd
                  startDate={startDate}
                  endDate={endDate}
                  minDate={startDate ?? undefined}
                  maxDate={new Date()}
                  showTimeSelect
                  timeIntervals={15}
                  placeholderText="Now"
                  className="date-input"
                  calendarClassName="date-calendar"
                  dateFormat="MMM d, yyyy h:mm aa"
                  isClearable
                  withPortal
                  portalId="filter-calendar-portal"
                  onCalendarOpen={() => {
                    const anchor = (endPickerFieldRef.current
                      ?.querySelector(".react-datepicker__input-container") as HTMLElement | null) ??
                      endPickerFieldRef.current;
                    handleCalendarOpen(anchor ?? undefined);
                  }}
                />
              </div>
            </div>
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
          <div className="history-window-section" aria-label="Records">
            <HistorySection
              heartbeats={pagedHeartbeats}
              totalCount={totalHeartbeatCount}
              page={page}
              totalPages={totalPages}
              hasPreviousPage={hasPreviousPage}
              hasNextPage={hasNextPage}
              onPreviousPage={handlePreviousPage}
              onNextPage={handleNextPage}
              isLoading={isHistoryLoading}
            />
          </div>
        </article>
      </section>



      <aside
        className={`device-panel-drawer${isDevicePanelOpen ? " device-panel-drawer--open" : ""}`}
        aria-hidden={!isDevicePanelOpen}
      >
        <header className="device-panel-drawer__header">
          <h2>Menu</h2>
          <button
            type="button"
            className="device-panel-drawer__close"
            onClick={toggleDevicePanel}
            aria-label="Close device panel"
          >
            ×
          </button>
        </header>
        <div className="device-panel-drawer__body">
          <section className="device-panel-section" aria-label="IoT device">
            <DeviceWidget
              ip={latestIp}
              tempF={latestTempF}
              humidity={latestHumidity}
              baselinePsi={latestBaselinePsi}
              lastHeartbeat={lastHeartbeatText}
              deviceConfig={deviceConfig}
              isDeviceConfigLoading={deviceConfigLoading}
              onSaveConfig={handleDeviceConfigSave}
            />
          </section>
          <section className="device-panel-section" aria-label="App preferences">
            <h3>Live updates</h3>
            <label className="checkbox-label device-panel-preference">
              <input
                type="checkbox"
                checked={isRealtimePreferenceEnabled}
                onChange={(event) => handleRealtimePreferenceToggle(event.target.checked)}
              />
              <span>Enable while app is open</span>
            </label>
          </section>
        </div>
      </aside>
      {isDevicePanelOpen ? (
        <div
          className="device-panel-backdrop"
          onClick={toggleDevicePanel}
          role="presentation"
        />
      ) : null}
    </main>
  );
};

export default App;
