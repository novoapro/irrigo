import type {
  AIScheduleConfig,
  DeviceConfig,
  ExternalControllerConfig,
  CompAIConfig,
  CompAIDiscoveryResult,
  Heartbeat,
  HeartbeatListMeta,
  HeartbeatListResponse,
  HeartbeatOverviewStats,
  HeartbeatSeriesSample,
  IrrigationCommand,
  IrrigationEvent,
  IrrigationListResponse,
  IrrigationMode,
  IrrigationProgram,
  IrrigationRecord,
  IrrigationRecordListResponse,
  ScheduleEntry,
  ScheduleRun,
  StatusPayload,
  SystemConfig,
  WeatherOverviewPayload,
  Zone,
  ZoneState
} from "./types";

const resolveApiBase = () => {
  const configured = import.meta.env.VITE_API_BASE_URL;
  if (configured) {
    if (configured.startsWith("http://") || configured.startsWith("https://")) {
      return configured;
    }
    if (configured.startsWith("/")) {
      if (typeof window !== "undefined") {
        return `${window.location.origin}${configured}`;
      }
      return `http://localhost${configured}`;
    }
    if (typeof window !== "undefined") {
      return `${window.location.origin}/${configured}`;
    }
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api`;
  }
  return "http://localhost:4000/api";
};

const API_BASE = resolveApiBase();

const normaliseBase = (base: string) => {
  if (!base.endsWith("/")) {
    return `${base}/`;
  }
  return base;
};

const buildUrl = (path: string, params?: Record<string, string | undefined>) => {
  const base = normaliseBase(API_BASE);
  const normalisedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(normalisedPath, base);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value) {
        url.searchParams.set(key, value);
      }
    });
  }
  return url.toString();
};

export const fetchStatus = async (): Promise<StatusPayload> => {
  const response = await fetch(buildUrl("/status"));
  if (!response.ok) {
    throw new Error(`Failed to fetch status (${response.status})`);
  }
  const payload = (await response.json()) as StatusPayload;
  return payload;
};

export interface HeartbeatQuery {
  start?: string;
  end?: string;
  page?: number;
  pageSize?: number;
  guard?: "true" | "false";
  rain?: "true" | "false";
  soil?: "true" | "false";
  psiMin?: string;
  psiMax?: string;
}

export interface IrrigationQuery {
  start?: string;
  end?: string;
  page?: number;
  pageSize?: number;
}

export const fetchHeartbeats = async (
  query?: HeartbeatQuery
): Promise<HeartbeatListResponse> => {
  const response = await fetch(
    buildUrl("/heartbeats", {
      start: query?.start,
      end: query?.end,
      page: query?.page ? query.page.toString() : undefined,
      pageSize: query?.pageSize ? query.pageSize.toString() : undefined,
      guard: query?.guard,
      rain: query?.rain,
      soil: query?.soil,
      psiMin: query?.psiMin,
      psiMax: query?.psiMax
    })
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch heartbeats (${response.status})`);
  }
  const payload = (await response.json()) as HeartbeatListResponse;
  return payload;
};

export const fetchIrrigationEvents = async (
  query?: IrrigationQuery
): Promise<IrrigationListResponse> => {
  const response = await fetch(
    buildUrl("/irrigation", {
      start: query?.start,
      end: query?.end,
      page: query?.page ? query.page.toString() : undefined,
      pageSize: query?.pageSize ? query.pageSize.toString() : undefined
    })
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch irrigation events (${response.status})`);
  }

  const payload = (await response.json()) as { events: IrrigationEvent[]; meta: HeartbeatListMeta };
  return { events: payload.events, meta: payload.meta };
};

export interface IrrigationRecordQuery {
  start?: string;
  end?: string;
  page?: number;
  pageSize?: number;
  zoneId?: string;
  source?: string;
}

export const fetchIrrigationRecords = async (
  query?: IrrigationRecordQuery
): Promise<IrrigationRecordListResponse> => {
  const response = await fetch(
    buildUrl("/irrigation-records", {
      start: query?.start,
      end: query?.end,
      page: query?.page ? query.page.toString() : undefined,
      pageSize: query?.pageSize ? query.pageSize.toString() : undefined,
      zoneId: query?.zoneId,
      source: query?.source
    })
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch irrigation records (${response.status})`);
  }
  return (await response.json()) as IrrigationRecordListResponse;
};

export const fetchLatestIrrigationPerZone = async (): Promise<IrrigationRecord[]> => {
  const response = await fetch(buildUrl("/irrigation-records/latest-per-zone"));
  if (!response.ok) {
    throw new Error(`Failed to fetch latest irrigation records (${response.status})`);
  }
  const json = (await response.json()) as { data: IrrigationRecord[] };
  return json.data;
};

export interface HeartbeatSeriesQuery {
  start?: string;
  end?: string;
  limit?: number;
}

export const fetchHeartbeatSeries = async (
  query?: HeartbeatSeriesQuery
): Promise<HeartbeatSeriesSample[]> => {
  const response = await fetch(
    buildUrl("/heartbeats/series", {
      start: query?.start,
      end: query?.end,
      limit: query?.limit ? query.limit.toString() : undefined
    })
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch heartbeat series (${response.status})`);
  }
  const payload = (await response.json()) as { data: HeartbeatSeriesSample[] };
  return payload.data;
};

export const fetchHeartbeatOverview = async (
  query?: HeartbeatSeriesQuery
): Promise<HeartbeatOverviewStats> => {
  const response = await fetch(
    buildUrl("/heartbeats/overview", {
      start: query?.start,
      end: query?.end
    })
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch heartbeat overview (${response.status})`);
  }
  const payload = (await response.json()) as { data: HeartbeatOverviewStats };
  return payload.data;
};

export interface ForecastQuery {
  start?: string;
  end?: string;
}

export const fetchWeatherForecast = async (query?: ForecastQuery) => {
  const response = await fetch(
    buildUrl("/weather/forecast", {
      start: query?.start,
      end: query?.end
    })
  );

  if (!response.ok) {
    throw new Error("Failed to fetch weather forecast");
  }

  const json = await response.json();
  return json.data as WeatherOverviewPayload;
};

export const fetchDeviceConfig = async () => {
  const response = await fetch(buildUrl(`/device/config/`));

  if (!response.ok) {
    throw new Error("Failed to fetch device config");
  }

  if(response.status === 204){
    return null;
  }

  const json = await response.json();
  return json.data as DeviceConfig | null;
};

const sanitizeDeviceConfigPayload = (config: Partial<DeviceConfig>) =>
  Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined && value !== null)
  );

export const updateDeviceConfig = async (config: Partial<DeviceConfig>) => {
  const payload = sanitizeDeviceConfigPayload(config);
  const response = await fetch(buildUrl(`/device/config/`), {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("Failed to update device config");
  }

  const json = await response.json();
  return json.data as DeviceConfig;
};

// --- Zone API ---

export const fetchZones = async (): Promise<Zone[]> => {
  const response = await fetch(buildUrl("/zones"));
  if (!response.ok) {
    throw new Error(`Failed to fetch zones (${response.status})`);
  }
  const json = (await response.json()) as { data: Zone[] };
  return json.data;
};

export const createZone = async (zone: Omit<Zone, "_id" | "createdAt" | "updatedAt">): Promise<Zone> => {
  const response = await fetch(buildUrl("/zones"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(zone)
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error((json as { message?: string }).message ?? `Failed to create zone (${response.status})`);
  }
  const json = (await response.json()) as { data: Zone };
  return json.data;
};

export const updateZone = async (zoneId: string, updates: Partial<Zone>): Promise<Zone> => {
  const response = await fetch(buildUrl(`/zones/${zoneId}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates)
  });
  if (!response.ok) {
    throw new Error(`Failed to update zone (${response.status})`);
  }
  const json = (await response.json()) as { data: Zone };
  return json.data;
};

export const deleteZone = async (zoneId: string): Promise<void> => {
  const response = await fetch(buildUrl(`/zones/${zoneId}`), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Failed to delete zone (${response.status})`);
  }
};

export const toggleZone = async (zoneId: string): Promise<Zone> => {
  const response = await fetch(buildUrl(`/zones/${zoneId}/toggle`), { method: "PATCH" });
  if (!response.ok) {
    throw new Error(`Failed to toggle zone (${response.status})`);
  }
  const json = (await response.json()) as { data: Zone };
  return json.data;
};

export const reorderZones = async (order: Array<{ zoneId: string; sortOrder: number }>): Promise<Zone[]> => {
  const response = await fetch(buildUrl("/zones/reorder"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order })
  });
  if (!response.ok) {
    throw new Error(`Failed to reorder zones (${response.status})`);
  }
  const json = (await response.json()) as { data: Zone[] };
  return json.data;
};

export const fetchZoneStates = async (): Promise<ZoneState[]> => {
  const response = await fetch(buildUrl("/zones/states"));
  if (!response.ok) {
    throw new Error(`Failed to fetch zone states (${response.status})`);
  }
  const json = (await response.json()) as { data: ZoneState[] };
  return json.data;
};

export const sendZoneCommand = async (
  zoneId: string,
  command: { action: "on" | "off"; durationMinutes?: number }
): Promise<IrrigationCommand> => {
  const response = await fetch(buildUrl(`/zones/${zoneId}/command`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error((json as { message?: string }).message ?? `Failed to send command (${response.status})`);
  }
  const json = (await response.json()) as { data: IrrigationCommand };
  return json.data;
};

// --- External Controller Config API ---

export const fetchExternalControllerConfig = async (): Promise<ExternalControllerConfig | null> => {
  const response = await fetch(buildUrl("/external-controller/config"));
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch external controller config (${response.status})`);
  }
  const json = (await response.json()) as { data: ExternalControllerConfig };
  return json.data;
};

export const updateExternalControllerConfig = async (
  config: Partial<ExternalControllerConfig>
): Promise<ExternalControllerConfig> => {
  const response = await fetch(buildUrl("/external-controller/config"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!response.ok) {
    throw new Error(`Failed to update external controller config (${response.status})`);
  }
  const json = (await response.json()) as { data: ExternalControllerConfig };
  return json.data;
};

export const testExternalController = async (): Promise<{ success: boolean; message: string }> => {
  const response = await fetch(buildUrl("/external-controller/test"), { method: "POST" });
  const json = (await response.json()) as { success: boolean; message: string };
  return json;
};

// --- CompAI Config API ---

export const fetchCompAIConfig = async (): Promise<CompAIConfig | null> => {
  const response = await fetch(buildUrl("/compai/config"));
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Failed to fetch CompAI config (${response.status})`);
  }
  const json = (await response.json()) as { data: CompAIConfig | null };
  return json.data;
};

export const updateCompAIConfig = async (
  config: Partial<CompAIConfig>
): Promise<CompAIConfig> => {
  const response = await fetch(buildUrl("/compai/config"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!response.ok) {
    throw new Error(`Failed to update CompAI config (${response.status})`);
  }
  const json = (await response.json()) as { data: CompAIConfig };
  return json.data;
};

export const testCompAIConnection = async (): Promise<{ success: boolean; message: string }> => {
  const response = await fetch(buildUrl("/compai/test"), { method: "POST" });
  const json = (await response.json()) as { success: boolean; message: string };
  return json;
};

export const discoverCompAIServices = async (): Promise<CompAIDiscoveryResult> => {
  const response = await fetch(buildUrl("/compai/services"));
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error((json as { message?: string }).message ?? `Discovery failed (${response.status})`);
  }
  const json = (await response.json()) as { data: CompAIDiscoveryResult };
  return json.data;
};

// --- AI Schedule API ---

export const fetchAIScheduleConfig = async (): Promise<AIScheduleConfig | null> => {
  const response = await fetch(buildUrl("/ai-schedule/config"));
  if (!response.ok) {
    throw new Error(`Failed to fetch AI schedule config (${response.status})`);
  }
  const json = (await response.json()) as { data: AIScheduleConfig | null };
  return json.data;
};

export const updateAIScheduleConfig = async (
  config: Partial<AIScheduleConfig>
): Promise<AIScheduleConfig> => {
  const response = await fetch(buildUrl("/ai-schedule/config"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error((json as { message?: string }).message ?? `Failed to update AI config (${response.status})`);
  }
  const json = (await response.json()) as { data: AIScheduleConfig };
  return json.data;
};

export const triggerAIScheduleRun = async (): Promise<{ runId: string; entriesCreated: number }> => {
  const response = await fetch(buildUrl("/ai-schedule/run"), { method: "POST" });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error((json as { message?: string }).message ?? `Schedule run failed (${response.status})`);
  }
  const json = (await response.json()) as { data: { runId: string; entriesCreated: number } };
  return json.data;
};

export const fetchScheduleRuns = async (page = 1): Promise<{ data: ScheduleRun[]; meta: HeartbeatListMeta }> => {
  const response = await fetch(buildUrl("/ai-schedule/runs", { page: page.toString() }));
  if (!response.ok) {
    throw new Error(`Failed to fetch schedule runs (${response.status})`);
  }
  return (await response.json()) as { data: ScheduleRun[]; meta: HeartbeatListMeta };
};

export const fetchScheduleRun = async (runId: string): Promise<ScheduleRun & { entries: ScheduleEntry[] }> => {
  const response = await fetch(buildUrl(`/ai-schedule/runs/${runId}`));
  if (!response.ok) {
    throw new Error(`Failed to fetch schedule run (${response.status})`);
  }
  const json = (await response.json()) as { data: ScheduleRun & { entries: ScheduleEntry[] } };
  return json.data;
};

export const fetchUpcomingEntries = async (): Promise<ScheduleEntry[]> => {
  const response = await fetch(buildUrl("/ai-schedule/entries/upcoming"));
  if (!response.ok) {
    throw new Error(`Failed to fetch upcoming entries (${response.status})`);
  }
  const json = (await response.json()) as { data: ScheduleEntry[] };
  return json.data;
};

export const cancelScheduleEntry = async (entryId: string): Promise<ScheduleEntry> => {
  const response = await fetch(buildUrl(`/ai-schedule/entries/${entryId}/cancel`), { method: "PATCH" });
  if (!response.ok) {
    throw new Error(`Failed to cancel entry (${response.status})`);
  }
  const json = (await response.json()) as { data: ScheduleEntry };
  return json.data;
};

export const skipScheduleEntry = async (entryId: string, reason?: string): Promise<ScheduleEntry> => {
  const response = await fetch(buildUrl(`/ai-schedule/entries/${entryId}/skip`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason })
  });
  if (!response.ok) {
    throw new Error(`Failed to skip entry (${response.status})`);
  }
  const json = (await response.json()) as { data: ScheduleEntry };
  return json.data;
};

export const fetchMaterializedProgramEntries = async (): Promise<ScheduleEntry[]> => {
  const response = await fetch(buildUrl("/ai-schedule/entries/program"));
  if (!response.ok) throw new Error(`Failed to fetch program entries (${response.status})`);
  const json = (await response.json()) as { data: ScheduleEntry[] };
  return json.data;
};

export const materializeProgramEntries = async (programId: string, scheduledAt: Date): Promise<{ entryIds: string[]; scheduleRunId: string }> => {
  const response = await fetch(buildUrl("/ai-schedule/entries/materialize"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ programId, scheduledAt: scheduledAt.toISOString() })
  });
  if (!response.ok) {
    throw new Error(`Failed to materialize entries (${response.status})`);
  }
  const json = (await response.json()) as { data: { entryIds: string[]; scheduleRunId: string } };
  return json.data;
};

export const deferScheduleEntry = async (entryId: string, plannedStartAt: Date): Promise<ScheduleEntry> => {
  const response = await fetch(buildUrl(`/ai-schedule/entries/${entryId}/defer`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plannedStartAt: plannedStartAt.toISOString() })
  });
  if (!response.ok) {
    throw new Error(`Failed to defer entry (${response.status})`);
  }
  const json = (await response.json()) as { data: ScheduleEntry };
  return json.data;
};

// --- System Config API ---

export const fetchSystemConfig = async (): Promise<SystemConfig> => {
  const response = await fetch(buildUrl("/system-config"));
  if (!response.ok) {
    throw new Error(`Failed to fetch system config (${response.status})`);
  }
  const json = (await response.json()) as { data: SystemConfig };
  return json.data;
};

export const updateSystemConfig = async (irrigationMode: IrrigationMode): Promise<SystemConfig> => {
  const response = await fetch(buildUrl("/system-config"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ irrigationMode })
  });
  if (!response.ok) {
    throw new Error(`Failed to update system config (${response.status})`);
  }
  const json = (await response.json()) as { data: SystemConfig };
  return json.data;
};

// --- Programs API ---

export const fetchPrograms = async (): Promise<IrrigationProgram[]> => {
  const response = await fetch(buildUrl("/programs"));
  if (!response.ok) {
    throw new Error(`Failed to fetch programs (${response.status})`);
  }
  const json = (await response.json()) as { data: IrrigationProgram[] };
  return json.data;
};

export const createProgram = async (
  data: Omit<IrrigationProgram, "_id" | "programId" | "createdAt" | "updatedAt">
): Promise<IrrigationProgram> => {
  const response = await fetch(buildUrl("/programs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error((json as { message?: string }).message ?? `Failed to create program (${response.status})`);
  }
  const json = (await response.json()) as { data: IrrigationProgram };
  return json.data;
};

export const updateProgram = async (
  programId: string,
  data: Partial<IrrigationProgram>
): Promise<IrrigationProgram> => {
  const response = await fetch(buildUrl(`/programs/${programId}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    throw new Error(`Failed to update program (${response.status})`);
  }
  const json = (await response.json()) as { data: IrrigationProgram };
  return json.data;
};

export const deleteProgram = async (programId: string): Promise<void> => {
  const response = await fetch(buildUrl(`/programs/${programId}`), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Failed to delete program (${response.status})`);
  }
};

export const runProgram = async (programId: string): Promise<{ programId: string; zonesTriggered: number }> => {
  const response = await fetch(buildUrl(`/programs/${programId}/run`), { method: "POST" });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error((json as { message?: string }).message ?? `Failed to run program (${response.status})`);
  }
  const json = (await response.json()) as { data: { programId: string; zonesTriggered: number } };
  return json.data;
};

// --- Manual Run API ---

export const triggerManualRun = async (): Promise<{ zoneId: string; commandId: string | null; error: string | null }[]> => {
  const response = await fetch(buildUrl("/manual-run"), { method: "POST" });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error((json as { message?: string }).message ?? `Manual run failed (${response.status})`);
  }
  const json = (await response.json()) as { data: { zoneId: string; commandId: string | null; error: string | null }[] };
  return json.data;
};

export const buildRealtimeUrl = () => {
  try {
    const base = API_BASE.endsWith("/")
      ? API_BASE.slice(0, -1)
      : API_BASE;
    const url = new URL(base);
    const path = url.pathname.replace(/\/+$/, "");
    if (path.endsWith("/api")) {
      url.pathname = `${path.slice(0, -4) || ""}/ws`;
    } else {
      url.pathname = `${path || ""}/ws`;
    }
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  } catch (error) {
    console.error("Failed to build realtime URL, using default:", error);
    return "ws://localhost:4000/ws";
  }
};
