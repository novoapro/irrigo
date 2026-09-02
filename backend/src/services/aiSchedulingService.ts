import { randomUUID } from "node:crypto";
import AIScheduleConfig from "../models/AIScheduleConfig";
import type { AIScheduleConfigAttributes } from "../models/AIScheduleConfig";
import ScheduleRun from "../models/ScheduleRun";
import type { WeatherContext } from "../models/ScheduleEntry";
import IrrigationProgram from "../models/IrrigationProgram";
import Zone from "../models/Zone";
import Heartbeat from "../models/Heartbeat";
import IrrigationEvent from "../models/IrrigationEvent";
import WeatherForecastSnapshot from "../models/WeatherForecastSnapshot";
import type { ForecastPeriodSnapshot } from "../models/WeatherForecastSnapshot";
import PrecipitationHistory from "../models/PrecipitationHistory";
import { callAI } from "./aiProviderService";
import { emitRealtimeEvent } from "./realtimeService";
import { getIrrigationSettings, getTimezone } from "./irrigationSettingsService";
import { getRainPauseState, type RainPauseState } from "./guardService";
import type { PreferredTimeWindow, WaterSavingMode } from "../models/configs/IrrigationSettings";

interface PendingProgram {
  programId: string;
  plannedStartAt: string;
  zones: Array<{ zoneId: string; durationMinutes: number }>;
  status: string;
}

interface GatheredData {
  zones: Array<{
    zoneId: string;
    name: string;
    defaultDurationMinutes: number;
    maxDurationMinutes: number;
    metadata?: Record<string, unknown>;
  }>;
  currentConditions: {
    rainDetected: boolean | null;
    soilSaturated: boolean | null;
    temperatureF: number | null;
    humidity: number | null;
  };
  forecastRainPeriods: Array<{
    startTime: string;
    precipitationProbability: number;
    shortForecast: string | null;
  }>;
  recentPrecipAboveThreshold: Array<{
    periodStart: string;
    probability: number;
  }>;
  recentIrrigationByZone: Record<string, Array<{
    action: string;
    source: string;
    createdAt: string;
  }>>;
  pendingPrograms: PendingProgram[];
  // Authoritative rain-pause state — the single source of truth from guardService.
  // buildPrompt formats this directly and never recomputes the pause.
  rainPause: RainPauseState;
  // Raw last-event timestamps below are DESCRIPTIVE CONTEXT only (the "Current
  // Conditions" section), never a pause decision — that lives entirely in rainPause.
  lastRainDetectedAt: string | null;
  lastSoilSaturatedAt: string | null;
  lastConfirmedRainAt: string | null;
  lastConfirmedRainIntensity: "light" | "moderate" | "heavy" | null;
  locationName: string;
}

const formatForPrompt = (date: Date, tz: string): string =>
  date.toLocaleString("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

const getTimezoneOffset = (date: Date, tz: string): string => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "longOffset"
  }).formatToParts(date);
  const offsetPart = parts.find((p) => p.type === "timeZoneName");
  const match = offsetPart?.value?.match(/GMT([+-]\d{2}:\d{2})/);
  return match?.[1] ?? "+00:00";
};

const gatherData = async (config: AIScheduleConfigAttributes): Promise<GatheredData> => {
  const zones = await Zone.find({ enabled: true }).sort({ sortOrder: 1 }).lean();
  const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
  const connected = latestHeartbeat?.device?.connectedSensors ?? [];
  const rainThreshold = config.preferences.rainThresholdPercent;

  const now = new Date();
  const windowMs = config.evaluationWindowHours * 3600_000;
  const windowEnd = new Date(now.getTime() + windowMs);
  const lookbackStart = new Date(now.getTime() - windowMs);

  const forecastSnapshot = await WeatherForecastSnapshot.findOne().sort({ fetchedAt: -1 }).lean();
  const forecastRainPeriods = (forecastSnapshot?.periods ?? [])
    .filter((p) => new Date(p.endTime) > now && new Date(p.startTime) < windowEnd)
    .filter((p) => (p.precipitationProbability ?? 0) >= rainThreshold)
    .map((p) => ({
      startTime: new Date(p.startTime).toISOString(),
      precipitationProbability: p.precipitationProbability!,
      shortForecast: p.shortForecast ?? null
    }));

  const recentPrecipAboveThreshold = (await PrecipitationHistory.find({
    periodStart: { $gte: lookbackStart, $lte: now },
    probability: { $gte: rainThreshold }
  }).sort({ periodStart: -1 }).lean()).map((p) => ({
    periodStart: p.periodStart.toISOString(),
    probability: p.probability
  }));

  const recentEvents = await IrrigationEvent.find({ createdAt: { $gte: lookbackStart } }).sort({ createdAt: -1 }).lean();
  const irrigationByZone: Record<string, Array<{ action: string; source: string; createdAt: string }>> = {};
  for (const event of recentEvents) {
    const key = event.zone;
    if (!irrigationByZone[key]) irrigationByZone[key] = [];
    irrigationByZone[key].push({ action: event.action, source: event.source ?? "unknown", createdAt: event.createdAt?.toISOString() ?? "" });
  }

  const pendingDbPrograms = await IrrigationProgram.find({
    source: "ai-schedule",
    status: { $in: ["planned", "deferred"] }
  }).sort({ plannedStartAt: 1 }).lean();

  const pendingPrograms: PendingProgram[] = pendingDbPrograms.map((p) => ({
    programId: p.programId,
    plannedStartAt: p.plannedStartAt?.toISOString() ?? "",
    zones: p.zoneEntries.map((z) => ({ zoneId: z.zoneId, durationMinutes: z.durationMinutes })),
    status: p.status
  }));

  const { default: IrrigationSettingsModel } = await import("../models/configs/IrrigationSettings");
  const irrigSettings = await IrrigationSettingsModel.findOne().lean();

  // Rain-pause decision comes entirely from the single authority. All watermark /
  // intensity / expiry logic lives in getRainPauseState — never re-derived here.
  const rainPause = await getRainPauseState(latestHeartbeat);

  // Raw last-event lookups below feed the descriptive "Current Conditions" section only,
  // so they intentionally reflect reality (it did rain N hours ago) without the pause
  // watermark. The pause rule itself is driven by `rainPause` above.
  const lastRainHeartbeat = connected.includes("RAIN")
    ? await Heartbeat.findOne({ "sensors.rain.triggered": true }).sort({ timestamp: -1 }).lean()
    : null;
  const lastSoilHeartbeat = connected.includes("SOIL")
    ? await Heartbeat.findOne({ "sensors.soil.triggered": true }).sort({ timestamp: -1 }).lean()
    : null;

  return {
    zones: zones.map((z) => ({
      zoneId: z.zoneId,
      name: z.name,
      defaultDurationMinutes: z.defaultDurationMinutes,
      maxDurationMinutes: z.maxDurationMinutes,
      metadata: z.metadata as Record<string, unknown> | undefined
    })),
    currentConditions: {
      rainDetected: connected.includes("RAIN") ? (latestHeartbeat?.sensors?.rain?.triggered ?? false) : null,
      soilSaturated: connected.includes("SOIL") ? (latestHeartbeat?.sensors?.soil?.triggered ?? false) : null,
      temperatureF: latestHeartbeat?.device?.tempF ?? null,
      humidity: latestHeartbeat?.device?.humidity ?? null
    },
    forecastRainPeriods,
    recentPrecipAboveThreshold,
    recentIrrigationByZone: irrigationByZone,
    pendingPrograms,
    rainPause,
    lastRainDetectedAt: lastRainHeartbeat ? new Date(lastRainHeartbeat.timestamp).toISOString() : null,
    lastSoilSaturatedAt: lastSoilHeartbeat ? new Date(lastSoilHeartbeat.timestamp).toISOString() : null,
    lastConfirmedRainAt: irrigSettings?.lastConfirmedRainAt ? new Date(irrigSettings.lastConfirmedRainAt).toISOString() : null,
    lastConfirmedRainIntensity: (irrigSettings?.lastConfirmedRainIntensity as "light" | "moderate" | "heavy") ?? null,
    locationName: forecastSnapshot?.locationName ?? process.env.WEATHER_LOCATION_NAME ?? "Unknown"
  };
};

const buildPrompt = (
  config: AIScheduleConfigAttributes,
  data: GatheredData,
  now: Date,
  preferredTimeWindows: PreferredTimeWindow[],
  waterSavingMode: WaterSavingMode,
  rainPauseHours: number,
  timezone: string
): { system: string; user: string } => {
  const prefs = config.preferences;
  const offset = getTimezoneOffset(now, timezone);
  const fmt = (d: Date) => formatForPrompt(d, timezone);

  // Rain-pause decision is read straight from the authority (data.rainPause) — no
  // recomputation here. The raw event timestamps below are descriptive context only.
  const rainPause = data.rainPause;
  const rainPauseActive = rainPause.active;

  const rainAt = data.lastRainDetectedAt ? new Date(data.lastRainDetectedAt) : null;
  const soilAt = data.lastSoilSaturatedAt ? new Date(data.lastSoilSaturatedAt) : null;
  const confirmedAt = data.lastConfirmedRainAt ? new Date(data.lastConfirmedRainAt) : null;

  const system = `You are an irrigation scheduling assistant. Respond with valid JSON only — no markdown, no text outside the JSON.
${rainPauseActive ? `
RAIN PAUSE IS ACTIVE. You MUST return:
{"newPrograms":[],"modifyPrograms":[],"cancelPrograms":[<cancel every pending program>],"keepPrograms":[],"skippedZones":[<skip every zone>],"summary":"Rain pause active — no irrigation allowed."}
` : ""}
All times are in ${timezone} (UTC${offset}). Return plannedStartAt as ISO 8601 with offset.

JSON schema:
{
  "newPrograms": [{"name":"string","plannedStartAt":"ISO 8601","zones":[{"zoneId":"string","durationMinutes":number}],"reasoning":"string"}],
  "modifyPrograms": [{"programId":"string","plannedStartAt":"ISO 8601 (optional)","zones":[{"zoneId":"string","durationMinutes":number}],"reasoning":"string"}],
  "cancelPrograms": [{"programId":"string","reasoning":"string"}],
  "keepPrograms": ["programId"],
  "skippedZones": [{"zoneId":"string","reason":"string"}],
  "summary": "string"
}`;

  const timeWindowsDesc = preferredTimeWindows.length > 0
    ? preferredTimeWindows.map((w) => `${w.startHour}:00–${w.endHour}:00`).join(", ")
    : "any time";

  const localNow = now.toLocaleString("en-US", {
    timeZone: timezone, weekday: "long", year: "numeric", month: "long",
    day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short"
  });

  // ── Rules section ──
  const rules: string[] = [];

  if (rainPauseHours > 0) {
    const lastEventAt = rainPause.lastRainEventAt ? new Date(rainPause.lastRainEventAt) : null;
    const status = rainPause.active
      ? `ACTIVE — last event: ${fmt(new Date(rainPause.triggeredAt!))} (${rainPause.source}), pause: ${rainPause.windowHours ?? rainPauseHours}h, expires: ${rainPause.expiresAt ? fmt(new Date(rainPause.expiresAt)) : "unknown"}`
      : lastEventAt
        ? `CLEAR — last event: ${fmt(lastEventAt)}, interval expired or pause cleared`
        : "CLEAR — no rain on record";
    rules.push(`1. Rain pause (${rainPauseHours}h base): ${status}. If ACTIVE: create no programs, cancel all pending, skip all zones.`);
  }
  rules.push(`${rules.length + 1}. Rain forecast: if precipitation probability >= ${prefs.rainThresholdPercent}% is forecast within the planning window, skip irrigation for affected periods.`);
  rules.push(`${rules.length + 1}. Irrigation windows: only schedule within ${timeWindowsDesc} (${timezone}).`);
  rules.push(`${rules.length + 1}. Water saving: ${waterSavingMode}${waterSavingMode === "moderate" ? " — reduce durations ~25-40%" : waterSavingMode === "aggressive" ? " — reduce durations ~40-60%, skip zones not critically dry" : ""}.`);
  rules.push(`${rules.length + 1}. Max daily irrigation: ${prefs.maxDailyRunMinutes} min. Min days between runs per zone: ${prefs.minDaysBetweenRuns}.`);
  rules.push(`${rules.length + 1}. Zones run sequentially within a program — account for total duration.`);
  rules.push(`${rules.length + 1}. A zone irrigated recently (manually or scheduled) may not need another run — check history before scheduling.`);

  // ── Conditions section ──
  const conditions: string[] = [];
  if (data.currentConditions.rainDetected === true) {
    conditions.push(`- Rain sensor: ACTIVE (currently raining)`);
  } else if (data.currentConditions.rainDetected === false) {
    conditions.push(`- Rain sensor: inactive${rainAt ? ` (last triggered: ${fmt(rainAt)}, ${((now.getTime() - rainAt.getTime()) / 3600_000).toFixed(0)}h ago)` : ""}`);
  }
  if (data.currentConditions.soilSaturated === true) {
    conditions.push(`- Soil moisture: SATURATED`);
  } else if (data.currentConditions.soilSaturated === false) {
    conditions.push(`- Soil moisture: dry${soilAt ? ` (last saturated: ${fmt(soilAt)}, ${((now.getTime() - soilAt.getTime()) / 3600_000).toFixed(0)}h ago)` : ""}`);
  }
  if (confirmedAt) {
    conditions.push(`- User-confirmed rain: ${fmt(confirmedAt)} (${((now.getTime() - confirmedAt.getTime()) / 3600_000).toFixed(0)}h ago)`);
  }
  conditions.push(`- Temperature: ${data.currentConditions.temperatureF?.toFixed(0) ?? "unknown"}°F, Humidity: ${data.currentConditions.humidity?.toFixed(0) ?? "unknown"}%`);

  // ── Forecast (only periods above rain threshold) ──
  const forecastSection = data.forecastRainPeriods.length > 0
    ? data.forecastRainPeriods.map((p) => `  ${fmt(new Date(p.startTime))}: ${p.precipitationProbability}% — ${p.shortForecast ?? ""}`).join("\n")
    : "  None above threshold.";

  // ── Recent precipitation (only above threshold) ──
  const precipSection = data.recentPrecipAboveThreshold.length > 0
    ? data.recentPrecipAboveThreshold.map((p) => `  ${fmt(new Date(p.periodStart))}: ${p.probability}%`).join("\n")
    : "";

  // ── Irrigation history (within planning window) ──
  const historyLines = data.zones.map((z) => {
    const events = data.recentIrrigationByZone[z.zoneId];
    if (!events || events.length === 0) return `  - ${z.name}: no recent irrigation`;
    const paired: string[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      if (ev.action !== "on") continue;
      const onTime = new Date(ev.createdAt);
      const offEvent = events.slice(i + 1).find((e) => e.action === "off");
      if (offEvent) {
        const durationMin = Math.round((new Date(offEvent.createdAt).getTime() - onTime.getTime()) / 60_000);
        paired.push(`    ${fmt(onTime)}: ${ev.source}, ~${durationMin}min`);
      } else {
        paired.push(`    ${fmt(onTime)}: ${ev.source} (still running)`);
      }
    }
    return paired.length > 0 ? `  - ${z.name}:\n${paired.join("\n")}` : `  - ${z.name}: no recent irrigation`;
  }).join("\n");

  // ── Zones ──
  const zoneLines = data.zones.map((z) => {
    const meta = z.metadata
      ? Object.entries(z.metadata).filter(([, v]) => v != null).map(([k, v]) => `${k}: ${v}`).join(", ")
      : "";
    return `  - ${z.zoneId} ("${z.name}"): ${z.defaultDurationMinutes}min default, ${z.maxDurationMinutes}min max${meta ? `, ${meta}` : ""}`;
  }).join("\n");

  // ── Pending programs ──
  const pendingLines = data.pendingPrograms.length > 0
    ? data.pendingPrograms.map((p) => {
        const zonesDesc = p.zones.map((z) => `${z.zoneId}(${z.durationMinutes}m)`).join(", ");
        return `  - ${p.programId}: ${fmt(new Date(p.plannedStartAt))}, [${zonesDesc}], ${p.status}`;
      }).join("\n")
    : "  None.";

  const user = `## Context
- Location: ${data.locationName}
- Now: ${localNow}
- Planning window: ${config.evaluationWindowHours}h forward, ${config.evaluationWindowHours}h lookback

## Rules
${rules.join("\n")}

## Current Conditions
${conditions.join("\n")}

## Rain Forecast (>= ${prefs.rainThresholdPercent}% precipitation, next ${config.evaluationWindowHours}h)
${forecastSection}
${precipSection ? `\n## Recent Precipitation (>= ${prefs.rainThresholdPercent}%, last ${config.evaluationWindowHours}h)\n${precipSection}\n` : ""}
## Irrigation History (last ${config.evaluationWindowHours}h)
${historyLines}

## Pending Programs
Every program must appear in exactly one of: keepPrograms, modifyPrograms, or cancelPrograms.
${pendingLines}

## Zones
${zoneLines}
${config.userContext ? `\n## Additional Instructions\n${config.userContext}\n` : ""}
## Task
Evaluate pending programs (keep/modify/cancel). Create new programs if zones need water and no rule blocks it. Skip zones that don't need irrigation. Respond with JSON only.`;

  return { system, user };
};

interface AIScheduleResponse {
  newPrograms: Array<{
    name: string;
    plannedStartAt: string;
    zones: Array<{ zoneId: string; durationMinutes: number }>;
    reasoning: string;
  }>;
  modifyPrograms?: Array<{
    programId: string;
    plannedStartAt?: string;
    zones?: Array<{ zoneId: string; durationMinutes: number }>;
    reasoning: string;
  }>;
  cancelPrograms?: Array<{
    programId: string;
    reasoning: string;
  }>;
  keepPrograms?: string[];
  skippedZones?: Array<{
    zoneId: string;
    reason: string;
  }>;
  summary: string;
}

const parseInTimezone = (dateStr: string, timezone: string): Date => {
  if (/[Zz]$|[+-]\d{2}(:\d{2})?$/.test(dateStr)) {
    return new Date(dateStr);
  }
  const offset = getTimezoneOffset(new Date(dateStr + "Z"), timezone);
  const invertedSign = offset.startsWith("+") ? "-" : "+";
  return new Date(`${dateStr}${invertedSign}${offset.slice(1)}`);
};

const parseAIResponse = (text: string, timezone: string): AIScheduleResponse => {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI response did not contain valid JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]) as AIScheduleResponse;

  if (!Array.isArray(parsed.newPrograms)) {
    throw new Error("AI response missing 'newPrograms' array");
  }

  for (const program of parsed.newPrograms) {
    if (!program.name || !program.plannedStartAt || !Array.isArray(program.zones) || program.zones.length === 0) {
      throw new Error(`Invalid new program: missing required fields for "${program.name ?? "unknown"}"`);
    }
    const d = parseInTimezone(program.plannedStartAt, timezone);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid date for program "${program.name}": ${program.plannedStartAt}`);
    }
    for (const zone of program.zones) {
      if (!zone.zoneId || !zone.durationMinutes) {
        throw new Error(`Invalid zone in program "${program.name}": missing zoneId or durationMinutes`);
      }
    }
  }

  for (const mod of parsed.modifyPrograms ?? []) {
    if (!mod.programId) {
      throw new Error(`Invalid modify program: missing programId`);
    }
    if (mod.plannedStartAt) {
      const d = parseInTimezone(mod.plannedStartAt, timezone);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`Invalid date for modified program ${mod.programId}: ${mod.plannedStartAt}`);
      }
    }
  }

  for (const cancel of parsed.cancelPrograms ?? []) {
    if (!cancel.programId) {
      throw new Error("Invalid cancel program: missing programId");
    }
  }

  return parsed;
};

export const runScheduleEvaluation = async (
  triggeredBy: "cron" | "manual" = "manual"
): Promise<{ runId: string; programsCreated: number }> => {
  const config = await AIScheduleConfig.findOne().lean();
  if (!config) throw new Error("AI schedule is not configured");
  if (!config.enabled) throw new Error("AI schedule is disabled");
  if (!config.apiKey) throw new Error("AI API key is not set");

  const scheduleRunId = randomUUID();
  const now = new Date();
  const timezone = await getTimezone();

  const run = await ScheduleRun.create({
    scheduleRunId,
    triggeredBy,
    status: "running",
    aiProvider: config.provider,
    aiModel: config.model,
    startedAt: now
  });

  emitRealtimeEvent({ type: "schedule:runStarted", payload: { scheduleRunId, triggeredBy } });

  try {
    const data = await gatherData(config);

    if (data.zones.length === 0) {
      run.status = "completed";
      run.reasoning = "No enabled zones to schedule.";
      run.entries = 0;
      run.completedAt = new Date();
      await run.save();

      await AIScheduleConfig.updateOne({}, {
        $set: { lastRunAt: now, lastRunStatus: "skipped", lastRunMessage: "No enabled zones" }
      });

      emitRealtimeEvent({ type: "schedule:runCompleted", payload: run.toObject() });
      return { runId: scheduleRunId, programsCreated: 0 };
    }

    const irrigationSettings = await getIrrigationSettings();
    const { system, user } = buildPrompt(config, data, now, irrigationSettings.preferredTimeWindows, irrigationSettings.waterSavingMode, irrigationSettings.rainPauseHours, timezone);

    run.systemPrompt = system;
    run.userPrompt = user;
    run.requestParams = { provider: config.provider, model: config.model, maxTokens: 4096 };

    const aiResult = await callAI(config.provider, config.model, config.apiKey, system, user);
    run.rawResponse = aiResult.text;

    const parsed = parseAIResponse(aiResult.text, timezone);

    const forecastSnapshot = await WeatherForecastSnapshot.findOne().sort({ fetchedAt: -1 }).lean();
    const currentPrecipProb = forecastSnapshot?.precipitationProbability ?? null;
    const currentForecast = forecastSnapshot?.shortForecast ?? null;
    const recentRainDetected = data.currentConditions.rainDetected ?? false;

    const weatherCtx: WeatherContext = {
      precipitationProbability: currentPrecipProb,
      forecastSummary: currentForecast,
      recentRainDetected
    };

    for (const cancel of parsed.cancelPrograms ?? []) {
      await IrrigationProgram.updateOne(
        { programId: cancel.programId, source: "ai-schedule", status: { $in: ["planned", "deferred"] } },
        { $set: { status: "cancelled", aiReasoning: cancel.reasoning, updatedAt: new Date() } }
      );
    }

    for (const mod of parsed.modifyPrograms ?? []) {
      const update: Record<string, unknown> = {
        aiReasoning: mod.reasoning,
        weatherContext: weatherCtx,
        updatedAt: new Date()
      };
      if (mod.plannedStartAt) {
        update.plannedStartAt = parseInTimezone(mod.plannedStartAt, timezone);
      }
      if (mod.zones && mod.zones.length > 0) {
        update.zoneEntries = mod.zones.map((z) => ({ zoneId: z.zoneId, durationMinutes: z.durationMinutes }));
      }
      await IrrigationProgram.updateOne(
        { programId: mod.programId, source: "ai-schedule", status: { $in: ["planned", "deferred"] } },
        { $set: update }
      );
    }

    const allNewPrograms = parsed.newPrograms.map((p) => ({
      programId: randomUUID(),
      name: p.name,
      enabled: true,
      source: "ai-schedule" as const,
      plannedStartAt: parseInTimezone(p.plannedStartAt, timezone),
      status: "planned" as const,
      scheduleRunId,
      aiReasoning: p.reasoning,
      weatherContext: weatherCtx,
      zoneEntries: p.zones.map((z) => ({ zoneId: z.zoneId, durationMinutes: z.durationMinutes }))
    }));

    const newPrograms = allNewPrograms.filter((p) => {
      if (p.plannedStartAt <= now) {
        console.warn(`[AIScheduling] Discarding program "${p.name}" — plannedStartAt ${p.plannedStartAt.toISOString()} is in the past`);
        return false;
      }
      return true;
    });

    if (newPrograms.length > 0) {
      await IrrigationProgram.insertMany(newPrograms);
    }

    const cancelCount = parsed.cancelPrograms?.length ?? 0;
    const modifyCount = parsed.modifyPrograms?.length ?? 0;

    run.status = "completed";
    run.reasoning = parsed.summary;
    run.entries = newPrograms.length;
    run.promptTokens = aiResult.promptTokens;
    run.completionTokens = aiResult.completionTokens;
    run.completedAt = new Date();
    await run.save();

    await AIScheduleConfig.updateOne({}, {
      $set: {
        lastRunAt: now,
        lastRunStatus: "success",
        lastRunMessage: `+${newPrograms.length} new, ~${modifyCount} modified, -${cancelCount} cancelled. ${parsed.summary}`
      }
    });

    emitRealtimeEvent({ type: "schedule:runCompleted", payload: run.toObject() });

    return { runId: scheduleRunId, programsCreated: newPrograms.length };
  } catch (err: any) {
    run.status = "error";
    run.errorMessage = err?.message ?? "Unknown error";
    run.completedAt = new Date();
    await run.save();

    await AIScheduleConfig.updateOne({}, {
      $set: {
        lastRunAt: now,
        lastRunStatus: "error",
        lastRunMessage: err?.message ?? "Unknown error"
      }
    });

    emitRealtimeEvent({ type: "schedule:runCompleted", payload: run.toObject() });
    throw err;
  }
};
