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
    baselinePsi: number | null;
    rainDetected: boolean | null;
    soilSaturated: boolean | null;
    temperatureF: number | null;
    humidity: number | null;
    connectedSensors: Array<"PRESSURE" | "RAIN" | "SOIL">;
  };
  historicalPsi: Array<{
    timestamp: string;
    psi: number;
  }>;
  forecast: Array<{
    startTime: string;
    endTime: string;
    temperature: number | null;
    precipitationProbability: number | null;
    isDaytime: boolean | null;
    shortForecast: string | null;
  }>;
  recentPrecipitation: Array<{
    periodStart: string;
    probability: number;
  }>;
  recentIrrigationByZone: Record<string, Array<{
    action: string;
    source: string;
    createdAt: string;
  }>>;
  pendingPrograms: PendingProgram[];
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

  const forecastSnapshot = await WeatherForecastSnapshot.findOne()
    .sort({ fetchedAt: -1 })
    .lean();

  const now = new Date();
  const windowEnd = new Date(now.getTime() + config.evaluationWindowHours * 3600_000);
  const futurePeriods: ForecastPeriodSnapshot[] = (forecastSnapshot?.periods ?? [])
    .filter((p) => new Date(p.endTime) > now && new Date(p.startTime) < windowEnd);

  const recentRainCutoff = new Date(now.getTime() - 24 * 3600_000);
  const recentPrecip = await PrecipitationHistory.find({
    periodStart: { $gte: recentRainCutoff, $lte: now },
    probability: { $gt: 0 }
  })
    .sort({ periodStart: -1 })
    .lean();

  const historicalPsiCutoff = new Date(now.getTime() - 20 * 24 * 3600_000);
  const historicalHeartbeats = await Heartbeat.find({
    timestamp: { $gte: historicalPsiCutoff },
    "sensors.waterPsi": { $exists: true, $ne: null }
  })
    .sort({ timestamp: -1 })
    .limit(200)
    .lean();

  const historicalPsi = historicalHeartbeats.map((h) => ({
    timestamp: new Date(h.timestamp).toISOString(),
    psi: h.sensors?.waterPsi as number
  }));

  const irrigationCutoff = new Date(now.getTime() - 7 * 24 * 3600_000);
  const recentEvents = await IrrigationEvent.find({
    createdAt: { $gte: irrigationCutoff }
  })
    .sort({ createdAt: -1 })
    .lean();

  const irrigationByZone: Record<string, Array<{ action: string; source: string; createdAt: string }>> = {};
  for (const event of recentEvents) {
    const key = event.zone;
    if (!irrigationByZone[key]) irrigationByZone[key] = [];
    irrigationByZone[key].push({
      action: event.action,
      source: event.source ?? "unknown",
      createdAt: event.createdAt?.toISOString() ?? ""
    });
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

  return {
    zones: zones.map((z) => ({
      zoneId: z.zoneId,
      name: z.name,
      defaultDurationMinutes: z.defaultDurationMinutes,
      maxDurationMinutes: z.maxDurationMinutes,
      metadata: z.metadata as Record<string, unknown> | undefined
    })),
    currentConditions: {
      baselinePsi: latestHeartbeat?.device?.baselinePsi ?? null,
      rainDetected: connected.includes("RAIN") ? (latestHeartbeat?.sensors?.rain ?? false) : null,
      soilSaturated: connected.includes("SOIL") ? (latestHeartbeat?.sensors?.soil ?? false) : null,
      temperatureF: latestHeartbeat?.device?.tempF ?? null,
      humidity: latestHeartbeat?.device?.humidity ?? null,
      connectedSensors: connected
    },
    historicalPsi,
    forecast: futurePeriods.map((p) => ({
      startTime: new Date(p.startTime).toISOString(),
      endTime: new Date(p.endTime).toISOString(),
      temperature: p.temperature,
      precipitationProbability: p.precipitationProbability,
      isDaytime: p.isDaytime,
      shortForecast: p.shortForecast
    })),
    recentPrecipitation: recentPrecip.map((p) => ({
      periodStart: p.periodStart.toISOString(),
      probability: p.probability
    })),
    recentIrrigationByZone: irrigationByZone,
    pendingPrograms,
    locationName: forecastSnapshot?.locationName ?? process.env.WEATHER_LOCATION_NAME ?? "Unknown"
  };
};

const buildPrompt = (
  config: AIScheduleConfigAttributes,
  data: GatheredData,
  now: Date,
  preferredTimeWindows: PreferredTimeWindow[],
  waterSavingMode: WaterSavingMode,
  timezone: string
): { system: string; user: string } => {
  const prefs = config.preferences;
  const offset = getTimezoneOffset(now, timezone);

  const system = `You are an irrigation scheduling assistant for a residential lawn and garden system. You manage the full irrigation schedule by creating, modifying, or cancelling irrigation programs. Your goal is to conserve water while keeping the landscape healthy.

A program groups one or more zones that should run together at a specific time. Zones within a program run sequentially (one after another), not in parallel. You can create separate programs for different times of day (e.g., a morning program and an evening program).

IMPORTANT: All times in this prompt are in the ${timezone} timezone (UTC${offset}). Return all plannedStartAt values as ISO 8601 with the timezone offset (e.g., 2025-06-07T20:00:00${offset}).

You MUST respond with valid JSON only — no markdown, no explanation outside the JSON. Use this exact schema:
{
  "newPrograms": [
    {
      "name": "string (descriptive name, e.g., 'Morning Lawn Care', 'Evening Garden')",
      "plannedStartAt": "ISO 8601 with timezone offset",
      "zones": [
        {
          "zoneId": "string",
          "durationMinutes": number
        }
      ],
      "reasoning": "1-2 sentence explanation"
    }
  ],
  "modifyPrograms": [
    {
      "programId": "string (from pending programs)",
      "plannedStartAt": "ISO 8601 with timezone offset (optional, include to change time)",
      "zones": [{ "zoneId": "string", "durationMinutes": number }],
      "reasoning": "1-2 sentence explanation"
    }
  ],
  "cancelPrograms": [
    {
      "programId": "string (from pending programs)",
      "reasoning": "1-2 sentence explanation"
    }
  ],
  "keepPrograms": ["programId1", "programId2"],
  "skippedZones": [
    {
      "zoneId": "string",
      "reason": "1-2 sentence explanation"
    }
  ],
  "summary": "1-3 sentence overall summary of the scheduling decision"
}`;

  const fmt = (d: Date) => formatForPrompt(d, timezone);

  const timeWindowsDesc = preferredTimeWindows.length > 0
    ? preferredTimeWindows
        .map((w) => `${w.startHour}:00 – ${w.endHour}:00`)
        .join(", ")
    : "any time";

  const forecastLines = data.forecast.slice(0, 48).map((p) => {
    const time = fmt(new Date(p.startTime));
    return `  ${time}: ${p.temperature ?? "?"}°F, precip ${p.precipitationProbability ?? 0}%, ${p.shortForecast ?? ""}`;
  }).join("\n");

  const recentPrecipLines = data.recentPrecipitation.length > 0
    ? data.recentPrecipitation.map((p) => {
        const time = fmt(new Date(p.periodStart));
        return `  ${time}: ${p.probability}% chance`;
      }).join("\n")
    : "";

  const historicalPsiLines = data.historicalPsi.slice(0, 40).map((h) => {
    const time = new Date(h.timestamp).toLocaleString("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", hour12: true });
    return `  ${time}: ${h.psi.toFixed(1)} PSI`;
  }).join("\n");

  const zoneLines = data.zones.map((z) => {
    const meta = z.metadata
      ? Object.entries(z.metadata)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : "none";
    return `  - ${z.zoneId} ("${z.name}"): default ${z.defaultDurationMinutes}min, max ${z.maxDurationMinutes}min, metadata: [${meta}]`;
  }).join("\n");

  const irrigationHistoryLines = data.zones.map((z) => {
    const events = data.recentIrrigationByZone[z.zoneId];
    if (!events || events.length === 0) return `  - ${z.zoneId} ("${z.name}"): no irrigation in last 7 days`;
    const paired: string[] = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i]!;
      if (ev.action !== "on") continue;
      const onTime = new Date(ev.createdAt);
      const offEvent = events.slice(i + 1).find((e) => e.action === "off");
      const fmtOn = onTime.toLocaleString("en-US", { timeZone: timezone, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
      if (offEvent) {
        const offTime = new Date(offEvent.createdAt);
        const durationMin = Math.round((offTime.getTime() - onTime.getTime()) / 60_000);
        const fmtOff = offTime.toLocaleString("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit", hour12: true });
        paired.push(`    ${fmtOn}: ON (${ev.source}) → OFF ${fmtOff} (~${durationMin}min)`);
      } else {
        paired.push(`    ${fmtOn}: ON (${ev.source})`);
      }
    }
    return `  - ${z.zoneId} ("${z.name}"):\n${paired.join("\n")}`;
  }).join("\n");

  const pendingProgramsLines = data.pendingPrograms.length > 0
    ? data.pendingPrograms.map((p) => {
        const time = fmt(new Date(p.plannedStartAt));
        const zonesDesc = p.zones.map((z) => `${z.zoneId} (${z.durationMinutes}min)`).join(", ");
        return `  - ${p.programId}: ${time}, zones: [${zonesDesc}], status: ${p.status}`;
      }).join("\n")
    : "  No pending programs — create new programs as needed.";

  const localNow = now.toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  });

  const user = `## System Context
- Location: ${data.locationName}
- Current time: ${localNow} (timezone: ${timezone})
- Planning window: next ${config.evaluationWindowHours} hours

## Zones
${zoneLines}

## Current Sensor Conditions
- Baseline water pressure: ${data.currentConditions.baselinePsi?.toFixed(1) ?? "unknown"} PSI (minimum system pressure required for proper sprinkler operation — avoid scheduling irrigation when pressure drops near or below this value)
- Rain sensor: ${data.currentConditions.rainDetected === null ? "not connected" : data.currentConditions.rainDetected ? "RAIN DETECTED" : "no rain"}
- Soil moisture: ${data.currentConditions.soilSaturated === null ? "not connected" : data.currentConditions.soilSaturated ? "SATURATED" : "dry"}
- Temperature: ${data.currentConditions.temperatureF?.toFixed(1) ?? "unknown"}°F
- Humidity: ${data.currentConditions.humidity?.toFixed(0) ?? "unknown"}%

## Historical Water Pressure (last 20 days)
Use this data to detect pressure patterns throughout the day. Prefer scheduling irrigation during times when pressure is consistently well above the baseline minimum. Avoid hours when pressure regularly dips.
${historicalPsiLines || "  No historical pressure data available"}

## Weather Forecast (next ${config.evaluationWindowHours}h)
${forecastLines || "  No forecast data available"}

${recentPrecipLines ? `## Recent Precipitation (last 24h)\n${recentPrecipLines}\n` : ""}## Irrigation History (last 7 days)
All irrigation events with source (manual = user-triggered, schedule = AI-scheduled, external = triggered externally). Factor manual runs into your decisions — a zone watered manually today may not need its scheduled run.
${irrigationHistoryLines}

## Pending AI Programs
Programs currently scheduled that have NOT yet executed. You have full control: keep, modify, or cancel.
Every pending program MUST appear in exactly one of: keepPrograms, modifyPrograms, or cancelPrograms. Modify existing programs instead of creating duplicates.
A "deferred" program was delayed by the system because conditions were unsuitable (e.g., low water pressure) — it will resume automatically, so leave it in keepPrograms.
${pendingProgramsLines}

## User Preferences
- Conservative watering: ${prefs.conservativeWatering ? "YES — skip irrigation if rain is expected" : "no"}
- Rain skip threshold: ${prefs.rainThresholdPercent}% precipitation probability
- Preferred irrigation windows: ${timeWindowsDesc} (${timezone})
- Max daily irrigation: ${prefs.maxDailyRunMinutes} minutes total
- Minimum days between runs per zone: ${prefs.minDaysBetweenRuns}
- Water saving mode: ${waterSavingMode}${waterSavingMode === "moderate" ? " — reduce zone durations by ~25-40% from defaults, prefer shorter more frequent runs" : waterSavingMode === "aggressive" ? " — minimize water usage, reduce zone durations by ~40-60% from defaults, skip zones that are not critically dry" : ""}
${config.userContext ? `\n## Additional User Instructions\n${config.userContext}` : ""}

## Task
You manage the irrigation schedule. Review sensor data, weather forecast, irrigation history (including manual runs), and pending programs, then produce the optimal schedule for the planning window.

1. Review each pending program and decide:
   - KEEP as-is → add its programId to keepPrograms
   - MODIFY (change time/zones/durations) → add to modifyPrograms with new values
   - CANCEL (no longer needed) → add to cancelPrograms with reason
   Every pending program MUST appear in exactly one of these three.
2. Identify gaps where zones need watering but have no pending program — create new programs in newPrograms.
   - Group zones that should run at the same time into a single program (e.g., all lawn zones in one morning program).
   - Use separate programs for different time slots (e.g., morning vs evening).
3. Zones that need no watering at all → add to skippedZones with explanation.

Decision factors:
- A zone watered manually today may not need its scheduled run — cancel or defer it
- Use historical water pressure patterns to prefer times when PSI is consistently well above the baseline minimum
- Factor in temperature and precipitation — prefer cooler hours (after sunset, before sunrise), skip if rain above ${prefs.rainThresholdPercent}% is forecast within 24-48h
- Remember: zones within a program run sequentially, so account for total program duration when scheduling
- Respect max daily irrigation minutes and minimum days between runs per zone${waterSavingMode === "moderate" ? "\n- Water saving mode is MODERATE: use noticeably shorter run times per zone than the defaults" : waterSavingMode === "aggressive" ? "\n- Water saving mode is AGGRESSIVE: minimize run times, use the shortest durations that keep plants alive, skip any zone that isn't critically in need" : ""}`;

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
    const { system, user } = buildPrompt(config, data, now, irrigationSettings.preferredTimeWindows, irrigationSettings.waterSavingMode, timezone);

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

    const newPrograms = parsed.newPrograms.map((p) => ({
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
