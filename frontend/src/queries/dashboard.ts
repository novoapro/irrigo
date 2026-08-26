import { useQuery } from "@tanstack/react-query";
import {
  fetchAIScheduleConfig,
  fetchDebugConfig,
  fetchDeviceConfig,
  fetchHeartbeatOverview,
  fetchHeartbeats,
  fetchHeartbeatSeries,
  fetchIrrigationEvents,
  fetchLatestIrrigationPerZone,
  fetchScheduleRun,
  fetchScheduleRuns,
  fetchStateSnapshot,
  fetchStatus,
  fetchSystemConfig,
  fetchWeatherForecast,
  fetchZones,
  fetchZoneStates,
  getManualRunStatus
} from "../api";
import type {
  DeviceConfig,
  Heartbeat,
  HeartbeatListMeta,
  ScheduleEntry,
  ScheduleRun,
  SequentialRun,
  ZoneState
} from "../types";
import type { RainPauseStatus } from "../api";
import { queryKeys, type HistoryWindow } from "./keys";

/**
 * Dashboard read-model hooks (Phase 3). Each family that previously lived as
 * `useState` + a polling `useEffect` in App.tsx is a `useQuery` here.
 *
 * Realtime-first behaviour: when the websocket channel is active the realtime
 * event handler pushes fresh data straight into the cache, so `refetchInterval`
 * polling is disabled (`realtimeActive` → `false`). When the channel is down we
 * fall back to the same intervals the manual polling loops used.
 */

export const STATUS_REFRESH_MS = 15 * 60_000;
export const HEARTBEAT_REFRESH_MS = 15 * 60_000;
export const FORECAST_REFRESH_MS = 15 * 60_000;
export const DEVICE_CONFIG_REFRESH_MS = 10 * 60_000;
export const HEARTBEAT_PAGE_SIZE = 15;
export const HEARTBEAT_SERIES_LIMIT = 250;

const interval = (realtimeActive: boolean, ms: number): number | false =>
  realtimeActive ? false : ms;

export const useStatusQuery = (realtimeActive: boolean) =>
  useQuery({
    queryKey: queryKeys.status,
    queryFn: async () => (await fetchStatus()) ?? null,
    refetchInterval: interval(realtimeActive, STATUS_REFRESH_MS)
  });

export type HeartbeatPageResult = {
  data: Heartbeat[];
  meta: HeartbeatListMeta;
};

export const useHeartbeatPageQuery = (
  window: HistoryWindow,
  page: number,
  realtimeActive: boolean
) =>
  useQuery({
    queryKey: queryKeys.heartbeatPage(window, page, HEARTBEAT_PAGE_SIZE),
    queryFn: async (): Promise<HeartbeatPageResult | null> =>
      (await fetchHeartbeats({
        start: window.start,
        end: window.end,
        page,
        pageSize: HEARTBEAT_PAGE_SIZE
      })) ?? null,
    refetchInterval: interval(realtimeActive, HEARTBEAT_REFRESH_MS)
  });

export const useHeartbeatSeriesQuery = (
  window: HistoryWindow,
  realtimeActive: boolean
) =>
  useQuery({
    queryKey: queryKeys.heartbeatSeries(window, HEARTBEAT_SERIES_LIMIT),
    queryFn: async () =>
      (await fetchHeartbeatSeries({
        start: window.start,
        end: window.end,
        limit: HEARTBEAT_SERIES_LIMIT
      })) ?? [],
    refetchInterval: interval(realtimeActive, HEARTBEAT_REFRESH_MS)
  });

export const useHeartbeatOverviewQuery = (
  window: HistoryWindow,
  realtimeActive: boolean
) =>
  useQuery({
    queryKey: queryKeys.heartbeatOverview(window),
    queryFn: async () =>
      (await fetchHeartbeatOverview({ start: window.start, end: window.end })) ??
      null,
    refetchInterval: interval(realtimeActive, HEARTBEAT_REFRESH_MS)
  });

export const useIrrigationEventsQuery = (
  window: HistoryWindow,
  realtimeActive: boolean
) =>
  useQuery({
    queryKey: queryKeys.irrigationEvents(window),
    queryFn: async () =>
      (await fetchIrrigationEvents({
        start: window.start,
        end: window.end,
        page: 1,
        pageSize: 500
      })) ?? { events: [], meta: null },
    refetchInterval: interval(realtimeActive, HEARTBEAT_REFRESH_MS)
  });

export const useIrrigationRecordsQuery = (realtimeActive: boolean) =>
  useQuery({
    queryKey: queryKeys.irrigationRecords,
    queryFn: async () => (await fetchLatestIrrigationPerZone()) ?? [],
    refetchInterval: interval(realtimeActive, HEARTBEAT_REFRESH_MS)
  });

export const useWeatherForecastQuery = (realtimeActive: boolean) =>
  useQuery({
    queryKey: queryKeys.weatherForecast,
    queryFn: async () => (await fetchWeatherForecast()) ?? null,
    refetchInterval: interval(realtimeActive, FORECAST_REFRESH_MS)
  });

export const useDeviceConfigQuery = (realtimeActive: boolean) =>
  useQuery({
    queryKey: queryKeys.deviceConfig,
    queryFn: async (): Promise<DeviceConfig | null> =>
      (await fetchDeviceConfig()) ?? null,
    // Realtime-first: only poll when the websocket is down; otherwise
    // deviceConfig:updated events keep the cache fresh.
    refetchInterval: interval(realtimeActive, DEVICE_CONFIG_REFRESH_MS)
  });

export const useZonesQuery = () =>
  useQuery({
    queryKey: queryKeys.zones,
    queryFn: async () => (await fetchZones()) ?? []
  });

export const useZoneStatesQuery = () =>
  useQuery({
    queryKey: queryKeys.zoneStates,
    queryFn: async (): Promise<Record<string, ZoneState>> => {
      const states = (await fetchZoneStates()) ?? [];
      const map: Record<string, ZoneState> = {};
      for (const s of states) {
        map[s.zoneId] = s;
      }
      return map;
    }
  });

export const useSystemConfigQuery = () =>
  useQuery({
    queryKey: queryKeys.systemConfig,
    queryFn: async () => (await fetchSystemConfig()) ?? null
  });

export const useAIScheduleConfigQuery = () =>
  useQuery({
    queryKey: queryKeys.aiScheduleConfig,
    queryFn: async () => (await fetchAIScheduleConfig()) ?? null
  });

export type LastAIRun = {
  run: ScheduleRun;
  entries: ScheduleEntry[];
} | null;

export const useLastAIRunQuery = () =>
  useQuery({
    queryKey: queryKeys.lastAIRun,
    queryFn: async (): Promise<LastAIRun> => {
      const runsResult = await fetchScheduleRuns(1);
      const run = runsResult?.data?.[0];
      if (!run) {
        return null;
      }
      let entries: ScheduleEntry[] = [];
      try {
        const detail = await fetchScheduleRun(run.scheduleRunId);
        entries = Array.isArray(detail.entries) ? detail.entries : [];
      } catch {
        /* entries are best-effort */
      }
      return { run, entries };
    }
  });

export const useManualRunQuery = () =>
  useQuery({
    queryKey: queryKeys.manualRun,
    queryFn: async (): Promise<SequentialRun | null> =>
      (await getManualRunStatus()) ?? null
  });

export const useDebugConfigQuery = () =>
  useQuery({
    queryKey: queryKeys.debugConfig,
    queryFn: async () => (await fetchDebugConfig()) ?? null
  });

export const useRainPauseQuery = () =>
  useQuery({
    queryKey: queryKeys.rainPause,
    queryFn: async (): Promise<RainPauseStatus> => {
      const snapshot = await fetchStateSnapshot();
      return snapshot?.rainPause ?? { active: false };
    }
  });
