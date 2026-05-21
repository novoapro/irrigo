import { randomUUID } from "node:crypto";
import AIScheduleConfig from "../models/AIScheduleConfig";
import type { AIScheduleConfigAttributes } from "../models/AIScheduleConfig";
import ScheduleRun from "../models/ScheduleRun";
import ScheduleEntry from "../models/ScheduleEntry";
import type { WeatherContext } from "../models/ScheduleEntry";
import Zone from "../models/Zone";
import Heartbeat from "../models/Heartbeat";
import IrrigationEvent from "../models/IrrigationEvent";
import WeatherForecastSnapshot from "../models/WeatherForecastSnapshot";
import type { ForecastPeriodSnapshot } from "../models/WeatherForecastSnapshot";
import PrecipitationHistory from "../models/PrecipitationHistory";
import { callAI } from "./aiProviderService";
import { emitRealtimeEvent } from "./realtimeService";

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
    createdAt: string;
  }>>;
  locationName: string;
}

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

  const recentRainCutoff = new Date(now.getTime() - config.preferences.recentRainWindowHours * 3600_000);
  const recentPrecip = await PrecipitationHistory.find({
    periodStart: { $gte: recentRainCutoff }
  })
    .sort({ periodStart: -1 })
    .limit(200)
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

  const irrigationByZone: Record<string, Array<{ action: string; createdAt: string }>> = {};
  for (const event of recentEvents) {
    const key = event.zone;
    if (!irrigationByZone[key]) irrigationByZone[key] = [];
    irrigationByZone[key].push({
      action: event.action,
      createdAt: event.createdAt?.toISOString() ?? ""
    });
  }

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
    locationName: forecastSnapshot?.locationName ?? process.env.WEATHER_LOCATION_NAME ?? "Unknown"
  };
};

const buildPrompt = (
  config: AIScheduleConfigAttributes,
  data: GatheredData,
  now: Date
): { system: string; user: string } => {
  const prefs = config.preferences;

  const system = `You are an irrigation scheduling assistant for a residential lawn and garden system. Your job is to create an optimal irrigation schedule that conserves water while keeping the landscape healthy.

You MUST respond with valid JSON only — no markdown, no explanation outside the JSON. Use this exact schema:
{
  "entries": [
    {
      "zoneId": "string",
      "plannedStartAt": "ISO 8601 datetime string",
      "plannedDurationMinutes": number,
      "reasoning": "1-2 sentence explanation"
    }
  ],
  "skippedZones": [
    {
      "zoneId": "string",
      "reason": "1-2 sentence explanation"
    }
  ],
  "summary": "1-3 sentence overall summary of the scheduling decision"
}`;

  const timeWindowsDesc = prefs.preferredTimeWindows.length > 0
    ? prefs.preferredTimeWindows
        .map((w) => `${w.startHour}:00 – ${w.endHour}:00`)
        .join(", ")
    : "any time";

  const forecastLines = data.forecast.slice(0, 48).map((p) => {
    const time = new Date(p.startTime).toLocaleString("en-US", { weekday: "short", hour: "numeric", hour12: true });
    return `  ${time}: ${p.temperature ?? "?"}°F, precip ${p.precipitationProbability ?? 0}%, ${p.shortForecast ?? ""}`;
  }).join("\n");

  const recentPrecipLines = data.recentPrecipitation.slice(0, 20).map((p) => {
    const time = new Date(p.periodStart).toLocaleString("en-US", { weekday: "short", hour: "numeric", hour12: true });
    return `  ${time}: ${p.probability}% chance`;
  }).join("\n");

  const historicalPsiLines = data.historicalPsi.slice(0, 40).map((h) => {
    const time = new Date(h.timestamp).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", hour12: true });
    return `  ${time}: ${h.psi.toFixed(1)} PSI`;
  }).join("\n");

  const zoneLines = data.zones.map((z) => {
    const meta = z.metadata
      ? Object.entries(z.metadata)
          .filter(([, v]) => v != null)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : "none";
    const recentIrrigation = data.recentIrrigationByZone[z.zoneId];
    const lastRun = recentIrrigation?.find((e) => e.action === "on");
    const lastRunDesc = lastRun ? new Date(lastRun.createdAt).toLocaleString("en-US") : "none in last 7 days";
    return `  - ${z.zoneId} ("${z.name}"): default ${z.defaultDurationMinutes}min, max ${z.maxDurationMinutes}min, metadata: [${meta}], last irrigation: ${lastRunDesc}`;
  }).join("\n");

  const user = `## System Context
- Location: ${data.locationName}
- Current time: ${now.toISOString()} (${now.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" })})
- Planning window: next ${config.evaluationWindowHours} hours

## Zones
${zoneLines}

## Current Sensor Conditions
- Baseline water pressure: ${data.currentConditions.baselinePsi?.toFixed(1) ?? "unknown"} PSI
- Rain sensor: ${data.currentConditions.rainDetected === null ? "not connected" : data.currentConditions.rainDetected ? "RAIN DETECTED" : "no rain"}
- Soil moisture: ${data.currentConditions.soilSaturated === null ? "not connected" : data.currentConditions.soilSaturated ? "SATURATED" : "dry"}
- Temperature: ${data.currentConditions.temperatureF?.toFixed(1) ?? "unknown"}°F
- Humidity: ${data.currentConditions.humidity?.toFixed(0) ?? "unknown"}%

## Historical Water Pressure (last 20 days)
${historicalPsiLines || "  No historical pressure data available"}

## Weather Forecast (next ${config.evaluationWindowHours}h)
${forecastLines || "  No forecast data available"}

## Recent Precipitation History (last ${prefs.recentRainWindowHours}h)
${recentPrecipLines || "  No precipitation data available"}

## User Preferences
- Conservative watering: ${prefs.conservativeWatering ? "YES — skip irrigation if rain is expected" : "no"}
- Rain skip threshold: ${prefs.rainThresholdPercent}% precipitation probability
- Preferred irrigation windows: ${timeWindowsDesc}
- Max daily irrigation: ${prefs.maxDailyRunMinutes} minutes total
- Minimum days between runs per zone: ${prefs.minDaysBetweenRuns}
- Water saving mode: ${prefs.waterSavingMode ?? "normal"}${prefs.waterSavingMode === "moderate" ? " — reduce zone durations by ~25-40% from defaults, prefer shorter more frequent runs" : prefs.waterSavingMode === "aggressive" ? " — minimize water usage, reduce zone durations by ~40-60% from defaults, skip zones that are not critically dry" : ""}
${config.userContext ? `\n## Additional User Instructions\n${config.userContext}` : ""}

## Task
Create an irrigation schedule for the planning window. For each zone:
1. Decide if it needs watering based on the data above
2. If yes, pick the optimal time within the preferred window and an appropriate duration
3. If no, explain why (recent rain, upcoming rain, already irrigated recently, etc.)

Be conservative with water. Prefer irrigating during cooler hours (after sunset, before sunrise). If rain above ${prefs.rainThresholdPercent}% is forecast within 24-48h, skip irrigation for zones that don't critically need it. Stagger zone start times so they don't overlap.${prefs.waterSavingMode === "moderate" ? " Use noticeably shorter run times per zone than the defaults." : prefs.waterSavingMode === "aggressive" ? " Aggressively minimize run times — use the shortest durations that keep plants alive. Skip any zone that isn't critically in need." : ""}`;

  return { system, user };
};

interface AIScheduleResponse {
  entries: Array<{
    zoneId: string;
    plannedStartAt: string;
    plannedDurationMinutes: number;
    reasoning: string;
  }>;
  skippedZones?: Array<{
    zoneId: string;
    reason: string;
  }>;
  summary: string;
}

const parseAIResponse = (text: string): AIScheduleResponse => {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI response did not contain valid JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]) as AIScheduleResponse;

  if (!Array.isArray(parsed.entries)) {
    throw new Error("AI response missing 'entries' array");
  }

  for (const entry of parsed.entries) {
    if (!entry.zoneId || !entry.plannedStartAt || !entry.plannedDurationMinutes) {
      throw new Error(`Invalid entry: missing required fields for zone ${entry.zoneId ?? "unknown"}`);
    }
    const d = new Date(entry.plannedStartAt);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid date for zone ${entry.zoneId}: ${entry.plannedStartAt}`);
    }
  }

  return parsed;
};

export const runScheduleEvaluation = async (
  triggeredBy: "cron" | "manual" = "manual"
): Promise<{ runId: string; entriesCreated: number }> => {
  const config = await AIScheduleConfig.findOne().lean();
  if (!config) throw new Error("AI schedule is not configured");
  if (!config.enabled) throw new Error("AI schedule is disabled");
  if (!config.apiKey) throw new Error("AI API key is not set");

  const scheduleRunId = randomUUID();
  const now = new Date();

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
      return { runId: scheduleRunId, entriesCreated: 0 };
    }

    const { system, user } = buildPrompt(config, data, now);
    const aiResult = await callAI(config.provider, config.model, config.apiKey, system, user);
    const parsed = parseAIResponse(aiResult.text);

    const forecastSnapshot = await WeatherForecastSnapshot.findOne().sort({ fetchedAt: -1 }).lean();
    const currentPrecipProb = forecastSnapshot?.precipitationProbability ?? null;
    const currentForecast = forecastSnapshot?.shortForecast ?? null;
    const recentRainDetected = data.currentConditions.rainDetected ?? false;

    const weatherCtx: WeatherContext = {
      precipitationProbability: currentPrecipProb,
      forecastSummary: currentForecast,
      recentRainDetected
    };

    const userModifiedEntries = await ScheduleEntry.find({
      status: "planned",
      userModified: true,
    }).lean();
    const protectedZones = new Set(userModifiedEntries.map((e) => e.zoneId));

    const entries = parsed.entries
      .filter((e) => !protectedZones.has(e.zoneId))
      .map((e) => ({
        scheduleRunId,
        zoneId: e.zoneId,
        plannedStartAt: new Date(e.plannedStartAt),
        plannedDurationMinutes: e.plannedDurationMinutes,
        status: "planned" as const,
        aiReasoning: e.reasoning,
        weatherContext: weatherCtx
      }));

    if (entries.length > 0) {
      await ScheduleEntry.insertMany(entries);
    }

    run.status = "completed";
    run.reasoning = parsed.summary;
    run.entries = entries.length;
    run.promptTokens = aiResult.promptTokens;
    run.completionTokens = aiResult.completionTokens;
    run.completedAt = new Date();
    await run.save();

    await AIScheduleConfig.updateOne({}, {
      $set: {
        lastRunAt: now,
        lastRunStatus: "success",
        lastRunMessage: `Created ${entries.length} entries. ${parsed.summary}`
      }
    });

    emitRealtimeEvent({ type: "schedule:runCompleted", payload: run.toObject() });

    return { runId: scheduleRunId, entriesCreated: entries.length };
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
