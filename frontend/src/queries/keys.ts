/**
 * Central query-key factory for the dashboard data families (Phase 3).
 *
 * Keeping every key in one place makes cache reads/writes and invalidations from
 * the realtime event handler unambiguous. Filter-bearing families (heartbeats,
 * overview, series) take the serialisable filter object as the trailing key
 * segment so distinct windows are cached independently.
 *
 * Concept — query keys in TanStack Query: a key is an array that uniquely
 * identifies a cache entry, e.g. `["status"]` or
 * `["heartbeats", "overview", {start, end}]`. Two rules matter:
 *   1. Keys are compared *structurally* (deep equality), so an inline object is
 *      fine as long as its contents match — different `{start,end}` windows map
 *      to different cache entries automatically.
 *   2. Keys are *hierarchical* by array prefix. All the heartbeat families share
 *      the `"heartbeats"` prefix, so a single
 *      `invalidateQueries({ queryKey: ["heartbeats"] })` refetches page, series,
 *      and overview at once — while `["status"]` is untouched.
 * Using `as const` freezes each key into a precise readonly tuple type, which
 * lets TypeScript catch typos at call sites.
 */
export type HistoryWindow = {
  start?: string;
  end?: string;
};

export const queryKeys = {
  status: ["status"] as const,
  deviceConfig: ["deviceConfig"] as const,
  zones: ["zones"] as const,
  zoneStates: ["zoneStates"] as const,
  weatherForecast: ["weatherForecast"] as const,
  systemConfig: ["systemConfig"] as const,
  aiScheduleConfig: ["aiScheduleConfig"] as const,
  lastAIRun: ["lastAIRun"] as const,
  manualRun: ["manualRun"] as const,
  debugConfig: ["debugConfig"] as const,
  rainPause: ["rainPause"] as const,
  irrigationRecords: ["irrigationRecords"] as const,
  heartbeatPage: (window: HistoryWindow, page: number, pageSize: number) =>
    ["heartbeats", "page", { ...window, page, pageSize }] as const,
  heartbeatSeries: (window: HistoryWindow, limit: number) =>
    ["heartbeats", "series", { ...window, limit }] as const,
  heartbeatOverview: (window: HistoryWindow) =>
    ["heartbeats", "overview", window] as const,
  irrigationEvents: (window: HistoryWindow) =>
    ["irrigationEvents", window] as const
} as const;
