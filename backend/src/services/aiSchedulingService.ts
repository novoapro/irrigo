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
import { getIrrigationSettings } from "./irrigationSettingsService";
import type { PreferredTimeWindow, WaterSavingMode } from "../models/configs/IrrigationSettings";

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
  pendingEntries: Array<{
    entryId: string;
    zoneId: string;
    plannedStartAt: string;
    plannedDurationMinutes: number;
    status: string;
    aiReasoning: string;
    userModified: boolean;
  }>;
  guardActive: boolean;
  recentDeferrals: Array<{
    type: string;
    zoneId?: string;
    deferredAt: string;
    reason: string;
    outcome: string;
  }>;
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

  const pendingDbEntries = await ScheduleEntry.find({
    status: { $in: ["planned", "queued", "deferred"] }
  }).sort({ plannedStartAt: 1 }).lean();

  const pendingEntries = pendingDbEntries.map((e) => ({
    entryId: (e as any)._id.toString(),
    zoneId: e.zoneId,
    plannedStartAt: e.plannedStartAt.toISOString(),
    plannedDurationMinutes: e.plannedDurationMinutes,
    status: e.status,
    aiReasoning: e.aiReasoning,
    userModified: e.userModified ?? false
  }));

  const guardActive = latestHeartbeat?.guard ?? false;

  const deferralCutoff = new Date(now.getTime() - 7 * 24 * 3600_000);
  const recentDeferredEntries = await ScheduleEntry.find({
    deferredAt: { $gte: deferralCutoff }
  }).sort({ deferredAt: -1 }).limit(20).lean();

  const recentDeferrals = recentDeferredEntries.map((e) => ({
    type: "schedule-entry",
    zoneId: e.zoneId,
    deferredAt: e.deferredAt?.toISOString() ?? "",
    reason: e.deferralReason ?? "Guard active",
    outcome: e.status === "deferred" ? "pending" : e.status === "completed" ? "resumed" : "expired"
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
    pendingEntries,
    guardActive,
    recentDeferrals,
    locationName: forecastSnapshot?.locationName ?? process.env.WEATHER_LOCATION_NAME ?? "Unknown"
  };
};

const buildPrompt = (
  config: AIScheduleConfigAttributes,
  data: GatheredData,
  now: Date,
  preferredTimeWindows: PreferredTimeWindow[],
  waterSavingMode: WaterSavingMode
): { system: string; user: string } => {
  const prefs = config.preferences;

  const system = `You are an irrigation scheduling assistant for a residential lawn and garden system. You manage the full irrigation schedule — creating new entries, modifying existing ones, or cancelling them as conditions change. Your goal is to conserve water while keeping the landscape healthy.

You MUST respond with valid JSON only — no markdown, no explanation outside the JSON. Use this exact schema:
{
  "newEntries": [
    {
      "zoneId": "string",
      "plannedStartAt": "ISO 8601 datetime string",
      "plannedDurationMinutes": number,
      "reasoning": "1-2 sentence explanation"
    }
  ],
  "modifyEntries": [
    {
      "entryId": "string (from pending entries)",
      "plannedStartAt": "ISO 8601 datetime string",
      "plannedDurationMinutes": number,
      "reasoning": "1-2 sentence explanation"
    }
  ],
  "cancelEntries": [
    {
      "entryId": "string (from pending entries)",
      "reasoning": "1-2 sentence explanation"
    }
  ],
  "keepEntries": ["entryId1", "entryId2"],
  "skippedZones": [
    {
      "zoneId": "string",
      "reason": "1-2 sentence explanation"
    }
  ],
  "summary": "1-3 sentence overall summary of the scheduling decision"
}`;

  const timeWindowsDesc = preferredTimeWindows.length > 0
    ? preferredTimeWindows
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
      const fmtOn = onTime.toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
      if (offEvent) {
        const offTime = new Date(offEvent.createdAt);
        const durationMin = Math.round((offTime.getTime() - onTime.getTime()) / 60_000);
        const fmtOff = offTime.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
        paired.push(`    ${fmtOn}: ON (${ev.source}) → OFF ${fmtOff} (~${durationMin}min)`);
      } else {
        paired.push(`    ${fmtOn}: ON (${ev.source})`);
      }
    }
    return `  - ${z.zoneId} ("${z.name}"):\n${paired.join("\n")}`;
  }).join("\n");

  const pendingEntriesLines = data.pendingEntries.length > 0
    ? data.pendingEntries.map((e) => {
        const time = new Date(e.plannedStartAt).toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
        const modified = e.userModified ? ", USER MODIFIED" : "";
        return `  - [entryId: ${e.entryId}] ${e.zoneId}, planned ${time}, ${e.plannedDurationMinutes}min${modified} — "${e.aiReasoning}"`;
      }).join("\n")
    : "  No pending entries — create new entries as needed.";

  const user = `## System Context
- Location: ${data.locationName}
- Current time: ${now.toISOString()} (${now.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" })})
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

## Recent Precipitation History (last ${prefs.recentRainWindowHours}h)
${recentPrecipLines || "  No precipitation data available"}

## Irrigation History (last 7 days)
All irrigation events with source (manual = user-triggered, schedule = AI-scheduled, external = triggered externally). Factor manual runs into your decisions — a zone watered manually today may not need its scheduled run.
${irrigationHistoryLines}

## Pending Scheduled Entries
Entries currently in the schedule that have NOT yet executed. You have full control over these: keep, modify (change time/duration), or cancel any of them.
Every pending entry MUST appear in exactly one of: keepEntries, modifyEntries, or cancelEntries. Do NOT create a new entry for a zone/time that already has a pending entry — modify it instead.
Entries marked USER MODIFIED were adjusted by the user; consider their intent but you may still change them if conditions make them inappropriate.
${pendingEntriesLines}

## Guard-Based Deferral
The irrigation guard indicates when conditions are not suitable for irrigation (e.g., low water pressure). When guard is ON, Irrigo will not execute irrigation.
If the guard is ON when an entry is due to execute, Irrigo will automatically defer it and resume when the guard clears and the current time is within a preferred irrigation window.
Entries with status "deferred" are being managed by the system — leave them in keepEntries.

Current guard state: ${data.guardActive ? "ON (conditions not suitable — irrigation blocked)" : "OFF (ready to irrigate)"}
${data.recentDeferrals.length > 0 ? `Recent deferrals (last 7 days):\n${data.recentDeferrals.map((d) => `  - ${d.zoneId ?? "program"}: deferred ${new Date(d.deferredAt).toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })} — ${d.reason} (${d.outcome})`).join("\n")}` : "No recent deferrals."}

## User Preferences
- Conservative watering: ${prefs.conservativeWatering ? "YES — skip irrigation if rain is expected" : "no"}
- Rain skip threshold: ${prefs.rainThresholdPercent}% precipitation probability
- Preferred irrigation windows: ${timeWindowsDesc}
- Max daily irrigation: ${prefs.maxDailyRunMinutes} minutes total
- Minimum days between runs per zone: ${prefs.minDaysBetweenRuns}
- Water saving mode: ${waterSavingMode}${waterSavingMode === "moderate" ? " — reduce zone durations by ~25-40% from defaults, prefer shorter more frequent runs" : waterSavingMode === "aggressive" ? " — minimize water usage, reduce zone durations by ~40-60% from defaults, skip zones that are not critically dry" : ""}
${config.userContext ? `\n## Additional User Instructions\n${config.userContext}` : ""}

## Task
You manage the irrigation schedule. Review sensor data, weather forecast, irrigation history (including manual runs), and pending entries, then produce the optimal schedule for the planning window.

1. Review each pending entry and decide:
   - KEEP as-is → add its entryId to keepEntries
   - MODIFY (change time/duration) → add to modifyEntries with new values
   - CANCEL (no longer needed) → add to cancelEntries with reason
   Every pending entry MUST appear in exactly one of these three.
2. Identify gaps where zones need watering but have no pending entry — add to newEntries.
3. Zones that need no watering at all → add to skippedZones with explanation.

Decision factors:
- A zone watered manually today may not need its scheduled run — cancel or defer it
- Use historical water pressure patterns to prefer times when PSI is consistently well above the baseline minimum
- Factor in temperature and precipitation — prefer cooler hours (after sunset, before sunrise), skip if rain above ${prefs.rainThresholdPercent}% is forecast within 24-48h
- Stagger zone start times so they don't overlap
- Respect max daily irrigation minutes and minimum days between runs per zone${waterSavingMode === "moderate" ? "\n- Water saving mode is MODERATE: use noticeably shorter run times per zone than the defaults" : waterSavingMode === "aggressive" ? "\n- Water saving mode is AGGRESSIVE: minimize run times, use the shortest durations that keep plants alive, skip any zone that isn't critically in need" : ""}`;

  return { system, user };
};

interface AIScheduleResponse {
  newEntries: Array<{
    zoneId: string;
    plannedStartAt: string;
    plannedDurationMinutes: number;
    reasoning: string;
  }>;
  modifyEntries?: Array<{
    entryId: string;
    plannedStartAt: string;
    plannedDurationMinutes: number;
    reasoning: string;
  }>;
  cancelEntries?: Array<{
    entryId: string;
    reasoning: string;
  }>;
  keepEntries?: string[];
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

  if (!Array.isArray(parsed.newEntries)) {
    throw new Error("AI response missing 'newEntries' array");
  }

  for (const entry of parsed.newEntries) {
    if (!entry.zoneId || !entry.plannedStartAt || !entry.plannedDurationMinutes) {
      throw new Error(`Invalid new entry: missing required fields for zone ${entry.zoneId ?? "unknown"}`);
    }
    const d = new Date(entry.plannedStartAt);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid date for zone ${entry.zoneId}: ${entry.plannedStartAt}`);
    }
  }

  for (const mod of parsed.modifyEntries ?? []) {
    if (!mod.entryId || !mod.plannedStartAt || !mod.plannedDurationMinutes) {
      throw new Error(`Invalid modify entry: missing required fields for entry ${mod.entryId ?? "unknown"}`);
    }
    const d = new Date(mod.plannedStartAt);
    if (Number.isNaN(d.getTime())) {
      throw new Error(`Invalid date for modified entry ${mod.entryId}: ${mod.plannedStartAt}`);
    }
  }

  for (const cancel of parsed.cancelEntries ?? []) {
    if (!cancel.entryId) {
      throw new Error("Invalid cancel entry: missing entryId");
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

    const irrigationSettings = await getIrrigationSettings();
    const { system, user } = buildPrompt(config, data, now, irrigationSettings.preferredTimeWindows, irrigationSettings.waterSavingMode);

    run.systemPrompt = system;
    run.userPrompt = user;
    run.requestParams = { provider: config.provider, model: config.model, maxTokens: 4096 };

    const aiResult = await callAI(config.provider, config.model, config.apiKey, system, user);
    run.rawResponse = aiResult.text;

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

    for (const cancel of parsed.cancelEntries ?? []) {
      await ScheduleEntry.updateOne(
        { _id: cancel.entryId, status: { $in: ["planned", "queued", "deferred"] } },
        { $set: { status: "cancelled", skipReason: cancel.reasoning } }
      );
    }

    for (const mod of parsed.modifyEntries ?? []) {
      await ScheduleEntry.updateOne(
        { _id: mod.entryId, status: { $in: ["planned", "queued"] } },
        { $set: {
          plannedStartAt: new Date(mod.plannedStartAt),
          plannedDurationMinutes: mod.plannedDurationMinutes,
          aiReasoning: mod.reasoning,
          weatherContext: weatherCtx
        }}
      );
    }

    const newDbEntries = parsed.newEntries.map((e) => ({
      scheduleRunId,
      zoneId: e.zoneId,
      plannedStartAt: new Date(e.plannedStartAt),
      plannedDurationMinutes: e.plannedDurationMinutes,
      status: "planned" as const,
      aiReasoning: e.reasoning,
      weatherContext: weatherCtx
    }));

    if (newDbEntries.length > 0) {
      await ScheduleEntry.insertMany(newDbEntries);
    }

    const cancelCount = parsed.cancelEntries?.length ?? 0;
    const modifyCount = parsed.modifyEntries?.length ?? 0;

    run.status = "completed";
    run.reasoning = parsed.summary;
    run.entries = newDbEntries.length;
    run.promptTokens = aiResult.promptTokens;
    run.completionTokens = aiResult.completionTokens;
    run.completedAt = new Date();
    await run.save();

    await AIScheduleConfig.updateOne({}, {
      $set: {
        lastRunAt: now,
        lastRunStatus: "success",
        lastRunMessage: `+${newDbEntries.length} new, ~${modifyCount} modified, -${cancelCount} cancelled. ${parsed.summary}`
      }
    });

    emitRealtimeEvent({ type: "schedule:runCompleted", payload: run.toObject() });

    return { runId: scheduleRunId, entriesCreated: newDbEntries.length };
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
