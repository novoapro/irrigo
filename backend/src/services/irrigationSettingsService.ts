import IrrigationSettings from "../models/configs/IrrigationSettings";
import type { PreferredTimeWindow, WaterSavingMode } from "../models/configs/IrrigationSettings";
import Config from "../models/Config";

const WATER_SAVING_FACTORS: Record<WaterSavingMode, number> = {
  normal: 1.0,
  moderate: 0.75,
  aggressive: 0.5
};

export const getIrrigationSettings = async () => {
  let doc = await IrrigationSettings.findOne().lean();
  if (!doc) {
    const created = await IrrigationSettings.create({});
    doc = created.toObject();
  }
  return doc;
};

export const getPreferredTimeWindows = async (): Promise<PreferredTimeWindow[]> => {
  const settings = await getIrrigationSettings();
  return settings.preferredTimeWindows;
};

export const isWithinPreferredWindow = async (date: Date): Promise<boolean> => {
  const windows = await getPreferredTimeWindows();
  return isTimeInWindows(date, windows);
};

export const isTimeInWindows = (date: Date, windows: PreferredTimeWindow[]): boolean => {
  if (windows.length === 0) return true;
  const hour = date.getHours();
  return windows.some((w) => {
    if (w.startHour === w.endHour) return true;
    if (w.startHour < w.endHour) {
      return hour >= w.startHour && hour < w.endHour;
    }
    // Overnight window (e.g. 20 → 6 means hour >= 20 OR hour < 6)
    return hour >= w.startHour || hour < w.endHour;
  });
};

export const getWaterSavingFactor = async (): Promise<number> => {
  const settings = await getIrrigationSettings();
  return WATER_SAVING_FACTORS[settings.waterSavingMode] ?? 1.0;
};

export const getWaterSavingMode = async (): Promise<WaterSavingMode> => {
  const settings = await getIrrigationSettings();
  return settings.waterSavingMode;
};

export const migrateIrrigationSettings = async (): Promise<void> => {
  const existing = await IrrigationSettings.findOne();
  if (existing) return;

  const aiConfig = await Config.findOne({ type: "aiSchedule" }).lean() as Record<string, unknown> | null;
  if (!aiConfig) {
    await IrrigationSettings.create({});
    console.log("[Migration] Created default IrrigationSettings");
    return;
  }

  const prefs = (aiConfig as any).preferences ?? {};
  const windows = Array.isArray(prefs.preferredTimeWindows) ? prefs.preferredTimeWindows : undefined;
  const mode = typeof prefs.waterSavingMode === "string" ? prefs.waterSavingMode : undefined;

  await IrrigationSettings.create({
    ...(windows && { preferredTimeWindows: windows }),
    ...(mode && { waterSavingMode: mode })
  });
  console.log("[Migration] Migrated IrrigationSettings from AIScheduleConfig");
};
