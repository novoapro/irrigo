import AIScheduleConfig from "../models/AIScheduleConfig";
import SystemConfig from "../models/SystemConfig";
import { runScheduleEvaluation } from "./aiSchedulingService";
import { getTimezone } from "./irrigationSettingsService";
import { cronMatchesNow, getMinuteKeyInTimezone } from "./cronUtils";

const CHECK_INTERVAL_MS = 30_000;
let cronTimer: NodeJS.Timeout | null = null;
let lastFiredMinute: string | null = null;

const checkCronTrigger = async () => {
  try {
    const sysConfig = await SystemConfig.findOne().lean();
    if (!sysConfig || sysConfig.irrigationMode !== "smart") return;

    const config = await AIScheduleConfig.findOne().lean();
    if (!config?.enabled || !config.scheduleCron || !config.apiKey) return;

    const tz = await getTimezone();
    if (!cronMatchesNow(config.scheduleCron, new Date(), tz)) return;

    const minuteKey = getMinuteKeyInTimezone(new Date(), tz);
    if (lastFiredMinute === minuteKey) return;
    lastFiredMinute = minuteKey;

    console.log("[AIScheduleCron] Triggering scheduled evaluation");
    await runScheduleEvaluation("cron");
    console.log("[AIScheduleCron] Evaluation completed");
  } catch (err) {
    console.error("[AIScheduleCron] Error during scheduled evaluation:", err);
  }
};

export const startAIScheduleCron = () => {
  if (cronTimer) return;
  cronTimer = setInterval(() => {
    void checkCronTrigger();
  }, CHECK_INTERVAL_MS);
  console.log("[AIScheduleCron] Started, checking every 30s");
};

export const stopAIScheduleCron = () => {
  if (cronTimer) {
    clearInterval(cronTimer);
    cronTimer = null;
    lastFiredMinute = null;
    console.log("[AIScheduleCron] Stopped");
  }
};
