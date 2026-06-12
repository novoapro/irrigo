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

const LOOKAHEAD_MS = 60_000;
const CHECK_INTERVAL_MS = 30_000;
let checkTimer: NodeJS.Timeout | null = null;

const buildZoneInputs = async (
  zoneEntries: { zoneId: string; durationMinutes: number }[]
): Promise<StartRunZoneInput[]> => {
  const zoneIds = zoneEntries.map((e) => e.zoneId);
  const zones = await Zone.find({ zoneId: { $in: zoneIds } }).lean();
  const nameMap = new Map(zones.map((z) => [z.zoneId, z.name]));

  return zoneEntries.map((e) => ({
    zoneId: e.zoneId,
    name: nameMap.get(e.zoneId) ?? e.zoneId,
    durationMinutes: e.durationMinutes
  }));
};

const executeAIProgram = async (programId: string) => {
  const program = await IrrigationProgram.findOne({ programId });
  if (!program || program.status !== "planned") return;

  const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
  if (latestHeartbeat?.guard) {
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
    const { getWaterSavingFactor } = await import("./irrigationSettingsService");
    const factor = await getWaterSavingFactor();
    const adjustedEntries = factor < 1
      ? program.zoneEntries.map((e) => ({ zoneId: e.zoneId, durationMinutes: Math.max(1, Math.round(e.durationMinutes * factor)) }))
      : program.zoneEntries;

    const inputs = await buildZoneInputs(adjustedEntries);
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
