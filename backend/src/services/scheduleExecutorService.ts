import IrrigationProgram from "../models/IrrigationProgram";
import Heartbeat from "../models/Heartbeat";
import WeatherForecastSnapshot from "../models/WeatherForecastSnapshot";
import AIScheduleConfig from "../models/AIScheduleConfig";
import SystemConfig from "../models/SystemConfig";
import Zone from "../models/Zone";
import { startSequentialRun, isRunActive } from "./sequentialRunService";
import type { StartRunZoneInput } from "./sequentialRunService";
import { emitRealtimeEvent } from "./realtimeService";
import { isWithinPreferredWindow } from "./irrigationSettingsService";
import { getEffectiveGuard } from "./guardService";

const LOOKAHEAD_MS = 60_000;
const CHECK_INTERVAL_MS = 30_000;
let checkTimer: NodeJS.Timeout | null = null;

export const buildZoneInputs = async (
  zoneEntries: { zoneId: string; durationMinutes: number }[]
): Promise<StartRunZoneInput[]> => {
  const zoneIds = zoneEntries.map((e) => e.zoneId);
  const zones = await Zone.find({ zoneId: { $in: zoneIds } }).lean();
  const nameMap = new Map(zones.map((z) => [z.zoneId, z.name]));
  const maxMap = new Map(zones.map((z) => [z.zoneId, z.maxDurationMinutes ?? 60]));
  const known = new Set(zones.map((z) => z.zoneId));

  const inputs: StartRunZoneInput[] = [];
  for (const e of zoneEntries) {
    // Skip a zone the AI invented (e.g. "lateral" instead of "laterals"). Letting an
    // unknown zoneId through makes createCommand throw "Zone not found" and fails the run;
    // dropping it lets the remaining valid zones still water.
    if (!known.has(e.zoneId)) {
      console.warn(`[ScheduleExecutor] Skipping unknown zone "${e.zoneId}" — not in zone config (bad AI zoneId).`);
      continue;
    }
    // AI-generated durations are not constrained by the program zod schema the way
    // user-entered programs are, so clamp them to a sane [1, zoneMax] range here.
    // An out-of-range value (0/negative/NaN → "few instants"; over-max → createCommand
    // throws and the zone fails) would otherwise make the run diverge from the plan.
    const max = maxMap.get(e.zoneId) ?? 60;
    const raw = Math.round(Number(e.durationMinutes));
    const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), max) : 1;
    if (clamped !== e.durationMinutes) {
      console.warn(
        `[ScheduleExecutor] Clamped zone ${e.zoneId} duration ${e.durationMinutes} → ${clamped}m (max ${max}m)`
      );
    }
    inputs.push({
      zoneId: e.zoneId,
      name: nameMap.get(e.zoneId) ?? e.zoneId,
      durationMinutes: clamped
    });
  }
  return inputs;
};

export const executeAIProgram = async (programId: string) => {
  const program = await IrrigationProgram.findOne({ programId });
  if (!program || program.status !== "planned") return;

  const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
  const guard = await getEffectiveGuard();

  // Rain pause is a known, multi-hour condition — cancel the scheduled program rather
  // than deferring it. (Programs whose start falls inside the window are also cancelled
  // proactively when the pause is triggered; this catches anything that slips through.)
  if (guard.rainPause.active) {
    const reason = guard.reason ?? "Rain pause active — irrigation paused";
    program.status = "cancelled";
    program.statusReason = reason;
    program.deferredAt = undefined;
    program.deferralDeadline = undefined;
    program.updatedAt = new Date();
    await program.save();
    emitRealtimeEvent({ type: "program:updated", payload: program.toObject() });
    return;
  }

  if (guard.hardware) {
    const reason = "Guard active — conditions not suitable for irrigation";
    const deadline = new Date(Date.now() + 24 * 60 * 60_000);
    program.status = "deferred";
    program.statusReason = reason;
    program.deferredAt = new Date();
    program.deferralDeadline = deadline;
    program.updatedAt = new Date();
    await program.save();
    emitRealtimeEvent({
      type: "deferral:triggered",
      payload: {
        type: "ai-program",
        programId: program.programId,
        reason,
        deadline: deadline.toISOString()
      }
    });
    return;
  }

  const config = await AIScheduleConfig.findOne().lean();
  if (!config?.enabled) {
    const reason = "AI scheduling disabled";
    program.status = "skipped";
    program.statusReason = reason;
    program.updatedAt = new Date();
    await program.save();
    emitRealtimeEvent({ type: "program:skipped", payload: { programId: program.programId, reason } });
    return;
  }

  if (config.preferences.conservativeWatering) {
    if (latestHeartbeat?.sensors?.rain) {
      const reason = "Rain detected — rain sensor active";
      program.status = "skipped";
      program.statusReason = reason;
      program.updatedAt = new Date();
      await program.save();
      emitRealtimeEvent({ type: "program:skipped", payload: { programId: program.programId, reason } });
      return;
    }

    const forecast = await WeatherForecastSnapshot.findOne().sort({ fetchedAt: -1 }).lean();
    const precipProb = forecast?.precipitationProbability ?? 0;
    if (precipProb >= config.preferences.rainThresholdPercent) {
      const reason = `Precipitation probability ${precipProb}% exceeds threshold (${config.preferences.rainThresholdPercent}%)`;
      program.status = "skipped";
      program.statusReason = reason;
      program.updatedAt = new Date();
      await program.save();
      emitRealtimeEvent({ type: "program:skipped", payload: { programId: program.programId, reason } });
      return;
    }
  }

  program.status = "executing";
  program.updatedAt = new Date();
  await program.save();
  emitRealtimeEvent({ type: "program:triggered", payload: { programId: program.programId, name: program.name } });

  try {
    // Do NOT re-apply the water-saving factor here. The AI planner already accounts
    // for waterSavingMode when it chooses each zone's durationMinutes (see the
    // "Water saving" rule in aiSchedulingService.buildPrompt), so multiplying again
    // double-counts the reduction and makes runs far shorter than what was scheduled.
    const inputs = await buildZoneInputs(program.zoneEntries);
    await startSequentialRun(inputs, "ai-schedule", program.programId);
  } catch (err: any) {
    const reason = `Execution failed — ${err?.message ?? "unknown error"}`;
    program.status = "skipped";
    program.statusReason = reason;
    program.updatedAt = new Date();
    await program.save();
    console.error(`[ScheduleExecutor] Failed to start AI program ${program.programId}:`, err);
  }
};

const checkPendingAIPrograms = async () => {
  const sysConfig = await SystemConfig.findOne().lean();
  if (!sysConfig || sysConfig.irrigationMode !== "smart") return;

  if (isRunActive()) return;

  const now = new Date();

  const inWindow = await isWithinPreferredWindow(now);

  if (!inWindow) {
    const expiredPrograms = await IrrigationProgram.find({
      source: "ai-schedule",
      status: "planned",
      enabled: true,
      plannedStartAt: { $lte: now }
    });

    for (const program of expiredPrograms) {
      const reason = "Irrigation window closed — conditions were never met during the eligible window";
      program.status = "skipped";
      program.statusReason = reason;
      program.updatedAt = new Date();
      await program.save();
      console.warn(`[ScheduleExecutor] Skipped expired program "${program.name}" (${program.programId})`);
      emitRealtimeEvent({ type: "program:skipped", payload: { programId: program.programId, reason } });
    }
    return;
  }

  const cutoff = new Date(now.getTime() + LOOKAHEAD_MS);

  const duePrograms = await IrrigationProgram.find({
    source: "ai-schedule",
    status: "planned",
    enabled: true,
    plannedStartAt: { $lte: cutoff }
  }).sort({ plannedStartAt: 1 });

  for (const program of duePrograms) {
    if (isRunActive()) break;
    await executeAIProgram(program.programId);
  }
};

export const startScheduleExecutor = () => {
  if (checkTimer) return;
  checkTimer = setInterval(() => {
    void checkPendingAIPrograms();
  }, CHECK_INTERVAL_MS);
  console.log("[ScheduleExecutor] Started, checking every 30s");
};

export const stopScheduleExecutor = () => {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
};
