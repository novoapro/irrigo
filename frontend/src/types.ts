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
  commandId?: string | null;
  source?: "manual" | "schedule" | "external" | null;
  createdAt: string;
}

export interface ZoneMetadata {
  plantType?: string;
  sunExposure?: "full" | "partial" | "shade";
  soilType?: string;
  area?: number;
  notes?: string;
}

export interface CompAICharacteristics {
  active?: string;
  setDuration?: string;
  inUse?: string;
  isConfigured?: string;
  remainingDuration?: string;
}

export interface CompAIZoneConfig {
  serviceId: string;
  characteristics?: CompAICharacteristics;
}

export interface Zone {
  _id?: string;
  zoneId: string;
  name: string;
  description?: string;
  enabled: boolean;
  sortOrder: number;
  defaultDurationMinutes: number;
  maxDurationMinutes: number;
  metadata?: ZoneMetadata;
  compAI?: CompAIZoneConfig | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ZoneState {
  zoneId: string;
  isActive: boolean;
  lastAction: "on" | "off" | null;
  lastEventAt: string | null;
  activeCommandId?: string | null;
  activeDurationMinutes?: number | null;
  remainingSeconds?: number | null;
}

export interface IrrigationCommand {
  _id: string;
  zoneId: string;
  action: "on" | "off";
  durationMinutes?: number | null;
  source: "manual" | "schedule";
  status: "pending" | "sent" | "acknowledged" | "failed" | "timeout";
  externalRequestId?: string | null;
  errorMessage?: string | null;
  sentAt?: string | null;
  acknowledgedAt?: string | null;
  createdAt: string;
}

export interface ExternalControllerConfig {
  _id?: string;
  name: string;
  endpoint: string;
  authType: "none" | "bearer" | "apikey" | "basic";
  authToken?: string | null;
  zoneMapping?: Record<string, string>;
  commandPath?: string;
  timeoutMs: number;
  enabled: boolean;
  updatedAt?: string;
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
  deviceName?: string;
  deviceDescription?: string;
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

export type IrrigationSource = "manual" | "program" | "ai-schedule";
export type IrrigationRecordStatus = "running" | "completed" | "failed";

export interface IrrigationRecord {
  _id: string;
  zoneId: string;
  source: IrrigationSource;
  status: IrrigationRecordStatus;
  startedAt: string;
  endedAt?: string | null;
  durationMs?: number | null;
  pressureStart?: number | null;
  pressureEnd?: number | null;
  commandId?: string | null;
  programId?: string | null;
  scheduleEntryId?: string | null;
  createdAt: string;
}

export interface IrrigationRecordListResponse {
  data: IrrigationRecord[];
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
    }
  | {
      type: "zone:created";
      payload?: Zone;
      at?: string;
    }
  | {
      type: "zone:updated";
      payload?: Zone;
      at?: string;
    }
  | {
      type: "zone:deleted";
      payload?: { zoneId: string };
      at?: string;
    }
  | {
      type: "command:created";
      payload?: IrrigationCommand;
      at?: string;
    }
  | {
      type: "command:updated";
      payload?: IrrigationCommand;
      at?: string;
    }
  | {
      type: "zoneState:changed";
      payload?: ZoneState;
      at?: string;
    }
  | {
      type: "schedule:runStarted";
      payload?: { scheduleRunId: string; triggeredBy: string };
      at?: string;
    }
  | {
      type: "schedule:runCompleted";
      payload?: ScheduleRun;
      at?: string;
    }
  | {
      type: "schedule:entryUpdated";
      payload?: ScheduleEntry;
      at?: string;
    }
  | {
      type: "systemConfig:updated";
      payload?: { irrigationMode: IrrigationMode };
      at?: string;
    }
  | {
      type: "program:created";
      payload?: IrrigationProgram;
      at?: string;
    }
  | {
      type: "program:updated";
      payload?: IrrigationProgram;
      at?: string;
    }
  | {
      type: "program:deleted";
      payload?: { programId: string };
      at?: string;
    }
  | {
      type: "program:triggered";
      payload?: { programId: string; name: string };
      at?: string;
    }
  | {
      type: "manualRun:completed";
      payload?: { results: { zoneId: string; commandId: string | null; error: string | null }[] };
      at?: string;
    };

export interface CompAIConfig {
  _id?: string;
  enabled: boolean;
  deviceId: string;
  endpoint?: string | null;
  authType?: "none" | "bearer" | "apikey" | "basic";
  authToken?: string | null;
  timeoutMs?: number;
  webhookSecret?: string | null;
  lastWebhookAt?: string | null;
  updatedAt?: string;
}

export interface CompAIDiscoveredService {
  id: string;
  name: string;
  type: string;
  characteristics: Record<string, string>;
}

export interface CompAIDiscoveryResult {
  deviceId: string;
  deviceName: string;
  isReachable: boolean;
  services: CompAIDiscoveredService[];
}

export type IrrigationMode = "smart" | "manual" | "scheduled";

export interface SystemConfig {
  irrigationMode: IrrigationMode;
  updatedAt?: string;
}

export interface ProgramZoneEntry {
  zoneId: string;
  durationMinutes: number;
}

export interface IrrigationProgram {
  _id?: string;
  programId: string;
  name: string;
  enabled: boolean;
  scheduleCron: string;
  zoneEntries: ProgramZoneEntry[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PreferredTimeWindow {
  startHour: number;
  endHour: number;
}

export interface AISchedulePreferences {
  conservativeWatering: boolean;
  rainThresholdPercent: number;
  recentRainWindowHours: number;
  preferredTimeWindows: PreferredTimeWindow[];
  maxDailyRunMinutes: number;
  minDaysBetweenRuns: number;
  waterSavingMode: "normal" | "moderate" | "aggressive";
}

export interface AIScheduleConfig {
  _id?: string;
  enabled: boolean;
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string | null;
  scheduleCron: string;
  evaluationWindowHours: number;
  userContext: string;
  preferences: AISchedulePreferences;
  lastRunAt?: string | null;
  lastRunStatus?: "success" | "error" | "skipped" | null;
  lastRunMessage?: string | null;
  updatedAt?: string;
}

export interface ScheduleRun {
  _id?: string;
  scheduleRunId: string;
  triggeredBy: "cron" | "manual";
  status: "running" | "completed" | "error";
  aiProvider: string;
  aiModel: string;
  promptTokens?: number;
  completionTokens?: number;
  entries: number;
  reasoning: string;
  errorMessage?: string | null;
  startedAt: string;
  completedAt?: string | null;
}

export interface WeatherContext {
  precipitationProbability: number | null;
  forecastSummary: string | null;
  recentRainDetected: boolean;
}

export interface ScheduleEntry {
  _id: string;
  scheduleRunId: string;
  zoneId: string;
  plannedStartAt: string;
  plannedDurationMinutes: number;
  status: "planned" | "queued" | "executing" | "completed" | "skipped" | "cancelled";
  commandId?: string | null;
  aiReasoning: string;
  weatherContext: WeatherContext;
  skipReason?: string | null;
  userModified?: boolean;
  programId?: string | null;
  createdAt: string;
  updatedAt: string;
}
