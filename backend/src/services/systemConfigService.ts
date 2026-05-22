import SystemConfig from "../models/SystemConfig";
import type { IrrigationMode } from "../models/SystemConfig";
import { startScheduleExecutor, stopScheduleExecutor } from "./scheduleExecutorService";
import { startAIScheduleCron, stopAIScheduleCron } from "./aiScheduleCronService";
import { startProgramScheduler, stopProgramScheduler } from "./programSchedulerService";
import { startGuardDeferralMonitor, stopGuardDeferralMonitor } from "./guardDeferralService";
import { runScheduleEvaluation } from "./aiSchedulingService";
import { emitRealtimeEvent } from "./realtimeService";

export const getSystemConfig = async () => {
  let config = await SystemConfig.findOne().lean();
  if (!config) {
    const created = await SystemConfig.create({ irrigationMode: "smart" });
    config = created.toObject();
  }
  return config;
};

export const updateSystemConfig = async (mode: IrrigationMode) => {
  const config = await SystemConfig.findOneAndUpdate(
    {},
    { irrigationMode: mode, updatedAt: new Date() },
    { upsert: true, new: true }
  ).lean();

  applyModeServices(mode);

  emitRealtimeEvent({ type: "systemConfig:updated", payload: { irrigationMode: mode } });

  return config;
};

export const applyModeServices = (mode: IrrigationMode) => {
  switch (mode) {
    case "smart":
      stopProgramScheduler();
      startScheduleExecutor();
      startAIScheduleCron();
      startGuardDeferralMonitor();
      runScheduleEvaluation("cron").catch((err) =>
        console.error("[applyModeServices] Initial smart evaluation failed:", err)
      );
      break;
    case "scheduled":
      stopScheduleExecutor();
      stopAIScheduleCron();
      startProgramScheduler();
      startGuardDeferralMonitor();
      break;
    case "manual":
      stopScheduleExecutor();
      stopAIScheduleCron();
      stopProgramScheduler();
      stopGuardDeferralMonitor();
      break;
  }
};
