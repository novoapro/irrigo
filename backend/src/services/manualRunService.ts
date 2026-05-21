import Zone from "../models/Zone";
import {
  startSequentialRun,
  cancelRun,
  getRunStatus,
  isRunActive
} from "./sequentialRunService";
import type { StartRunZoneInput } from "./sequentialRunService";

export const runAllZones = async (
  zoneOverrides?: { zoneId: string; durationMinutes: number }[]
): Promise<string> => {
  const zones = await Zone.find({
    enabled: true,
    excludeFromManualRun: { $ne: true }
  }).sort({ sortOrder: 1 }).lean();

  if (zones.length === 0) throw new Error("No eligible zones for manual run");

  const overrideMap = new Map(
    (zoneOverrides ?? []).map((o) => [o.zoneId, o.durationMinutes])
  );

  const zoneInputs: StartRunZoneInput[] = zones.map((z) => ({
    zoneId: z.zoneId,
    name: z.name,
    durationMinutes: overrideMap.get(z.zoneId) ?? z.defaultDurationMinutes
  }));

  return startSequentialRun(zoneInputs, "manual");
};

export const cancelManualRun = cancelRun;

export const getManualRunStatus = getRunStatus;

export const isManualRunActive = isRunActive;
