/**
 * types.ts — the shared TypeScript vocabulary for the whole frontend.
 *
 * Role in the app: a single source of truth for the shapes of data exchanged
 * with the backend (heartbeats, zones, commands, schedules, realtime events).
 * Components, hooks, and query functions all import from here so the same
 * concept has exactly one definition.
 *
 * The domain in brief: an IoT irrigation controller emits periodic *heartbeats*
 * (sensor + device readings). *Zones* are waterable areas; each has a live
 * *ZoneState*. *Commands* turn zones on/off. A *SequentialRun* waters several
 * zones in order. An AI *ScheduleRun* plans future watering. The backend pushes
 * changes to the UI as *RealtimeEvent*s (see the big union near the bottom).
 *
 * Concept demonstrated: TypeScript `interface`/`type` modeling, string-literal
 * unions for closed sets of values (e.g. `"on" | "off"`), and — most
 * importantly — a discriminated union for realtime events.
 */

/** Raw sensor readings carried on every heartbeat. */
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

/**
 * A single telemetry sample from the device. `guard` is the safety-cutoff flag;
 * `sensors`/`device` carry the readings; `weather` is an optional snapshot taken
 * at the same time. The stream of heartbeats is the app's primary data feed.
 */
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

/**
 * A configured waterable area (its durations, ordering, metadata, and optional
 * CompAI mapping). This is *configuration* — the live runtime status lives in
 * `ZoneState` below.
 */
export interface Zone {
  _id?: string;
  zoneId: string;
  name: string;
  description?: string;
  enabled: boolean;
  excludeFromManualRun?: boolean;
  sortOrder: number;
  defaultDurationMinutes: number;
  maxDurationMinutes: number;
  metadata?: ZoneMetadata;
  compAI?: CompAIZoneConfig | null;
  createdAt?: string;
  updatedAt?: string;
}

/** The live runtime status of one zone: is it on right now, what was the last
 * action, and how much of the current run remains. Pairs with `Zone`. */
export interface ZoneState {
  zoneId: string;
  isActive: boolean;
  lastAction: "on" | "off" | null;
  lastEventAt: string | null;
  activeCommandId?: string | null;
  activeDurationMinutes?: number | null;
  remainingSeconds?: number | null;
  remainingUpdatedAt?: string | null;
}

/** A single on/off instruction sent to a zone, tracked through its delivery
 * lifecycle (`status`: pending -> sent -> acknowledged/failed/timeout) along with
 * the controller response for debugging. */
export interface IrrigationCommand {
  _id: string;
  zoneId: string;
  action: "on" | "off";
  durationMinutes?: number | null;
  source: "manual" | "schedule" | "program" | "ai-schedule";
  status: "pending" | "sent" | "acknowledged" | "failed" | "timeout";
  externalRequestId?: string | null;
  errorMessage?: string | null;
  controllerMethod?: "compai" | "external" | "debug" | null;
  controllerUrl?: string | null;
  controllerResponseStatus?: number | null;
  controllerResponseBody?: string | null;
  sentAt?: string | null;
  acknowledgedAt?: string | null;
  createdAt: string;
}

export interface WebhookEvent {
  _id: string;
  deviceId: string;
  serviceId: string;
  serviceName?: string | null;
  characteristicId: string;
  characteristicType: string;
  characteristicName?: string | null;
  oldValue: unknown;
  newValue: unknown;
  zoneId?: string | null;
  zoneName?: string | null;
  processed: boolean;
  result?: string | null;
  receivedAt: string;
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

/**
 * The consolidated "current state of the system" object the dashboard renders at
 * the top. Combines the latest guard/sensor/device readings with derived flags
 * (`ready`, active `irrigation`) and a `changes` map describing what just moved.
 * Delivered both by a REST status endpoint and by `status:updated` realtime
 * events.
 */
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

export type SequentialRunSource = "manual" | "program" | "ai-schedule";
export type SequentialRunZoneStatus = "queued" | "activating" | "running" | "completed" | "skipped" | "failed" | "deferred";

export interface SequentialRunZoneEntry {
  zoneId: string;
  name: string;
  durationMinutes: number;
  status: SequentialRunZoneStatus;
  commandId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

/** One "water these zones in order" job: its ordered `zones`, which one is
 * current (`currentZoneIndex`), and lifecycle status. Can be deferred (e.g. by
 * rain) and later recovered. */
export interface SequentialRun {
  _id: string;
  source: SequentialRunSource;
  programId?: string | null;
  status: "running" | "deferred" | "completed" | "cancelled" | "failed";
  statusReason?: string | null;
  zones: SequentialRunZoneEntry[];
  currentZoneIndex: number;
  startedAt: string;
  completedAt?: string | null;
  deferredAt?: string | null;
  deferralDeadline?: string | null;
}

// These `ManualRun*` names are the *old* names for the `SequentialRun*` types.
// Rather than rename every call site at once (risky), we keep the old names as
// type aliases pointing at the new ones and mark them `@deprecated`. Editors
// strike through deprecated identifiers, nudging callers to migrate gradually
// while nothing breaks. This is a safe, incremental rename technique.
/** @deprecated Use SequentialRun */
export type ManualRun = SequentialRun;
/** @deprecated Use SequentialRunZoneEntry */
export type ManualRunZoneEntry = SequentialRunZoneEntry;
/** @deprecated Use SequentialRunZoneStatus */
export type ManualRunZoneStatus = SequentialRunZoneStatus;

/**
 * Every message the backend can push over the websocket, as a DISCRIMINATED
 * UNION. Each member shares a string-literal `type` field (the "discriminant")
 * and carries its own `payload` shape.
 *
 * Why this pattern is powerful: inside `switch (event.type) { ... }`, TypeScript
 * *narrows* the union in each `case`. In `case "heartbeat:new":` it knows
 * `event.payload` is a `Heartbeat`; in `case "zone:deleted":` it knows it's
 * `{ zoneId: string }`. You get exhaustive, type-safe event handling with no
 * casts — add a new event variant and the compiler flags every switch that
 * hasn't handled it. `payload` is optional (`?`) because a few events (e.g.
 * `connection:ready`) carry no data. `at` is an optional server timestamp.
 */
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
      type: "sequentialRun:started";
      payload?: SequentialRun;
      at?: string;
    }
  | {
      type: "sequentialRun:zoneProgress";
      payload?: SequentialRun;
      at?: string;
    }
  | {
      type: "sequentialRun:completed";
      payload?: SequentialRun;
      at?: string;
    }
  | {
      type: "sequentialRun:cancelled";
      payload?: SequentialRun;
      at?: string;
    }
  | {
      type: "deferral:triggered";
      payload?: { type: string; runId?: string; entryId?: string; programId?: string; zoneId?: string; reason: string; deadline?: string | null };
      at?: string;
    }
  | {
      type: "deferral:recovered";
      payload?: { type: string; runId?: string; entryId?: string; programId?: string; zoneId?: string };
      at?: string;
    }
  | {
      type: "deferral:expired";
      payload?: { type: string; runId?: string; entryId?: string; programId?: string; reason: string };
      at?: string;
    }
  | {
      type: "debugMode:changed";
      payload?: { enabled: boolean };
      at?: string;
    }
  | {
      type: "rain:confirmed";
      payload?: { confirmedAt: string; intensity: string };
      at?: string;
    }
  | {
      type: "rain:promptResponded";
      payload?: { respondedAt: string; response: string };
      at?: string;
    }
  | {
      type: "rain:pauseCleared";
      payload?: { rainPause?: unknown };
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

export interface DebugConfig {
  _id?: string;
  enabled: boolean;
  updatedAt?: string;
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

export type ProgramSource = "manual" | "ai-schedule";
export type ProgramStatus = "planned" | "executing" | "completed" | "cancelled" | "skipped" | "deferred";

export interface IrrigationProgram {
  _id?: string;
  programId: string;
  name: string;
  enabled: boolean;
  source: ProgramSource;
  scheduleCron?: string;
  plannedStartAt?: string;
  status?: ProgramStatus;
  scheduleRunId?: string;
  aiReasoning?: string;
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
  maxDailyRunMinutes: number;
  minDaysBetweenRuns: number;
}

export type WaterSavingMode = "normal" | "moderate" | "aggressive";

export type RainIntensity = "light" | "moderate" | "heavy";

export interface IrrigationSettings {
  _id?: string;
  preferredTimeWindows: PreferredTimeWindow[];
  waterSavingMode: WaterSavingMode;
  rainPauseHours: number;
  lastConfirmedRainAt?: string | null;
  lastConfirmedRainIntensity?: RainIntensity | null;
  timezone: string;
  updatedAt?: string;
}

export interface AIScheduleConfig {
  _id?: string;
  enabled: boolean;
  provider: "anthropic" | "openai" | "google";
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

/** One execution of the AI scheduler: which model was used, token counts, the
 * model's `reasoning`, and the raw prompt/response for auditability. Its planned
 * watering slots are `ScheduleEntry`s. */
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
  systemPrompt?: string | null;
  userPrompt?: string | null;
  rawResponse?: string | null;
  requestParams?: {
    provider: string;
    model: string;
    maxTokens: number;
  } | null;
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
  status: "planned" | "queued" | "executing" | "completed" | "skipped" | "cancelled" | "deferred";
  commandId?: string | null;
  aiReasoning: string;
  weatherContext: WeatherContext;
  skipReason?: string | null;
  userModified?: boolean;
  programId?: string | null;
  deferredAt?: string | null;
  deferralDeadline?: string | null;
  deferralReason?: string | null;
  createdAt: string;
  updatedAt: string;
}
