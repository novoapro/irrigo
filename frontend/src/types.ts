export interface HeartbeatSensors {
  waterPsi: number;
  rain: boolean;
  soil: boolean;
}

export type ConnectedSensor = "PRESSURE" | "RAIN" | "SOIL";

export interface HeartbeatDevice {
  ip: string;
  tempF: number;
  humidity: number;
  baselinePsi: number;
  connectedSensors?: ConnectedSensor[];
}

export interface WeatherConditionsSnapshot {
  locationName: string;
  fetchedAt: string;
  expiresAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  temperature: number | null;
  temperatureUnit: string | null;
  precipitationProbability: number | null;
  isDaytime: boolean | null;
  shortForecast: string | null;
}

export interface Heartbeat {
  _id?: string;
  guard: boolean;
  sensors: HeartbeatSensors;
  device: HeartbeatDevice;
  timestamp: string;
  weather?: WeatherConditionsSnapshot | null;
}

export interface IrrigationEvent {
  _id?: string;
  zone: string;
  action: "on" | "off";
  waterPressure?: number | null;
  createdAt: string;
}

export interface StatusPayload {
  guard: boolean;
  ready: boolean;
  lastUpdatedAt?: string | null;
  sensors: HeartbeatSensors;
  device: HeartbeatDevice;
  weather?: WeatherConditionsSnapshot | null;
  irrigation?: {
    active: boolean;
    zone: string | null;
    action: "on" | "off" | null;
  };
  changes?: {
    guard: string | null;
    sensors: {
      waterPsi: string | null;
      rain: string | null;
      soil: string | null;
    };
    irrigation?: string | null;
  };
}

export interface WeatherOverviewPayload {
  fetchedAt: string;
  locationName: string;
  expiresAt?: string;
  periodStart?: string;
  periodEnd?: string;
  temperature?: number | null;
  temperatureUnit?: string | null;
  precipitationProbability?: number | null;
  isDaytime?: boolean | null;
  precipitationOutlook: Array<{
    periodStart: string;
    probability: number | null;
  }>;
  shortForecast?: string | null;
}

export interface DeviceConfig {
  baselineDefault?: number;
  sampleIntervalMs?: number;
  heartbeatIntervalMs?: number;
  psiSpikeDelta?: number;
  rainEnabled?: boolean;
  moistEnabled?: boolean;
  guardEnabled?: boolean;
  forceHeartbeat?: boolean;
  updatedAt?: string;
  deviceIp?: string;
}

export interface HeartbeatListMeta {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface IrrigationListResponse {
  events: IrrigationEvent[];
  meta: HeartbeatListMeta;
}

export interface HeartbeatListResponse {
  data: Heartbeat[];
  meta: HeartbeatListMeta;
}

export interface HeartbeatOverviewStats {
  guard: {
    activeMs: number;
    inactiveMs: number;
  };
  rainDays: {
    positive: number;
    negative: number;
  };
  soilDays: {
    positive: number;
    negative: number;
  };
  pressure: {
    activeMs: number;
    inactiveMs: number;
  };
  range: {
    start: string | null;
    end: string | null;
  };
}

export interface HeartbeatSeriesSample {
  timestamp: string;
  psi: number;
}

export type RealtimeEvent =
  | {
      type: "connection:ready";
      at?: string;
    }
  | {
      type: "forceHeartbeat:queued";
      payload?: { deviceIp?: string | null };
      at?: string;
    }
  | {
      type: "forceHeartbeat:acknowledged";
      payload?: { deviceIp?: string | null };
      at?: string;
    }
  | {
      type: "heartbeat:new";
      payload?: Heartbeat;
      at?: string;
    }
  | {
      type: "deviceConfig:updated";
      payload?: DeviceConfig;
      at?: string;
    }
  | {
      type: "status:updated";
      payload?: StatusPayload;
      at?: string;
    }
  | {
      type: "irrigation:updated";
      payload?: IrrigationEvent;
      at?: string;
    }
  | {
      type: "forecast:new";
      payload?: WeatherOverviewPayload;
      at?: string;
    };
