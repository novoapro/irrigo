import type {
  DeviceConfig,
  Heartbeat,
  HeartbeatListMeta,
  HeartbeatListResponse,
  HeartbeatOverviewStats,
  HeartbeatSeriesSample,
  IrrigationEvent,
  IrrigationListResponse,
  StatusPayload,
  WeatherOverviewPayload
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
      pageSize: query?.pageSize ? query.pageSize.toString() : undefined
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
