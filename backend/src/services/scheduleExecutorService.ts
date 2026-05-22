import ScheduleEntry from "../models/ScheduleEntry";
import Heartbeat from "../models/Heartbeat";
import WeatherForecastSnapshot from "../models/WeatherForecastSnapshot";
import AIScheduleConfig from "../models/AIScheduleConfig";
import SystemConfig from "../models/SystemConfig";
import { createCommand } from "./irrigationCommandService";
import { emitRealtimeEvent } from "./realtimeService";

const LOOKAHEAD_MS = 60_000;
const CHECK_INTERVAL_MS = 30_000;
let checkTimer: NodeJS.Timeout | null = null;

const executeEntry = async (entryId: string) => {
  const entry = await ScheduleEntry.findById(entryId);
  if (!entry || entry.status !== "planned") return;

  const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
  if (latestHeartbeat?.guard) {
    if (entry.deferralEnabled) {
      const deadline = new Date(
        entry.plannedStartAt.getTime() + entry.deferralWindowMinutes * 60_000
      );
      entry.status = "deferred";
      entry.deferredAt = new Date();
      entry.deferralDeadline = deadline;
      entry.deferralReason = "Guard active — conditions not suitable for irrigation";
      entry.updatedAt = new Date();
      await entry.save();
      emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
      emitRealtimeEvent({
        type: "deferral:triggered",
        payload: {
          type: "schedule-entry",
          entryId: entry._id.toString(),
          zoneId: entry.zoneId,
          reason: "Guard active — conditions not suitable for irrigation",
          deadline: deadline.toISOString()
        }
      });
      return;
    }
    entry.status = "skipped";
    entry.skipReason = "Guard active — irrigation not permitted";
    entry.updatedAt = new Date();
    await entry.save();
    emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
    return;
  }

  const config = await AIScheduleConfig.findOne().lean();
  if (!config?.enabled) {
    entry.status = "skipped";
    entry.skipReason = "AI scheduling was disabled before execution";
    entry.updatedAt = new Date();
    await entry.save();
    emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
    return;
  }

  if (config.preferences.conservativeWatering) {
    const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
    if (latestHeartbeat?.sensors?.rain) {
      entry.status = "skipped";
      entry.skipReason = "Rain detected at execution time";
      entry.updatedAt = new Date();
      await entry.save();
      emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
      return;
    }

    const forecast = await WeatherForecastSnapshot.findOne().sort({ fetchedAt: -1 }).lean();
    const precipProb = forecast?.precipitationProbability ?? 0;
    if (precipProb >= config.preferences.rainThresholdPercent) {
      entry.status = "skipped";
      entry.skipReason = `Precipitation probability ${precipProb}% exceeds threshold ${config.preferences.rainThresholdPercent}%`;
      entry.updatedAt = new Date();
      await entry.save();
      emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
      return;
    }
  }

  entry.status = "queued";
  entry.updatedAt = new Date();
  await entry.save();
  emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });

  try {
    entry.status = "executing";
    entry.updatedAt = new Date();
    await entry.save();
    emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });

    const command = await createCommand(
      entry.zoneId,
      "on",
      entry.plannedDurationMinutes,
      "ai-schedule"
    );

    entry.commandId = (command as any)._id?.toString() ?? null;
    entry.status = "completed";
    entry.updatedAt = new Date();
    await entry.save();
    emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
  } catch (err: any) {
    entry.status = "skipped";
    entry.skipReason = `Command failed: ${err?.message ?? "unknown error"}`;
    entry.updatedAt = new Date();
    await entry.save();
    emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
  }
};

const checkPendingEntries = async () => {
  const sysConfig = await SystemConfig.findOne().lean();
  if (!sysConfig || sysConfig.irrigationMode !== "smart") return;

  const now = new Date();
  const cutoff = new Date(now.getTime() + LOOKAHEAD_MS);

  const entries = await ScheduleEntry.find({
    status: "planned",
    plannedStartAt: { $lte: cutoff }
  }).sort({ plannedStartAt: 1 });

  for (const entry of entries) {
    await executeEntry(entry._id.toString());
  }
};

export const startScheduleExecutor = () => {
  if (checkTimer) return;
  checkTimer = setInterval(() => {
    void checkPendingEntries();
  }, CHECK_INTERVAL_MS);
  console.log("[ScheduleExecutor] Started, checking every 30s");
};

export const stopScheduleExecutor = () => {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
};
