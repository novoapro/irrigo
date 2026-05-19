import AIScheduleConfig from "../models/AIScheduleConfig";
import SystemConfig from "../models/SystemConfig";
import { runScheduleEvaluation } from "./aiSchedulingService";

const CHECK_INTERVAL_MS = 30_000;
let cronTimer: NodeJS.Timeout | null = null;
let lastFiredMinute: string | null = null;

const getCurrentMinuteKey = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
};

const cronMatchesNow = (cron: string): boolean => {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const now = new Date();
  const minute = parseInt(parts[0]!, 10);
  const hour = parseInt(parts[1]!, 10);
  const dayOfMonth = parts[2]!;
  const dayOfWeek = parts[4]!;

  if (now.getMinutes() !== minute) return false;
  if (now.getHours() !== hour) return false;

  if (dayOfWeek !== "*") {
    const dow = parseInt(dayOfWeek, 10);
    if (now.getDay() !== dow) return false;
  }

  if (dayOfMonth !== "*") {
    if (dayOfMonth.startsWith("*/")) {
      const interval = parseInt(dayOfMonth.slice(2), 10);
      if (interval > 0 && now.getDate() % interval !== 1) return false;
    }
  }

  return true;
};

const checkCronTrigger = async () => {
  try {
    const sysConfig = await SystemConfig.findOne().lean();
    if (!sysConfig || sysConfig.irrigationMode !== "smart") return;

    const config = await AIScheduleConfig.findOne().lean();
    if (!config?.enabled || !config.scheduleCron || !config.apiKey) return;

    if (!cronMatchesNow(config.scheduleCron)) return;

    const minuteKey = getCurrentMinuteKey();
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
