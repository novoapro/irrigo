import Zone from "../models/Zone";
import { createCommand } from "./irrigationCommandService";
import { emitRealtimeEvent } from "./realtimeService";

export const runAllZones = async () => {
  const zones = await Zone.find({ enabled: true }).sort({ sortOrder: 1 }).lean();
  if (zones.length === 0) throw new Error("No enabled zones");

  const results: { zoneId: string; commandId: string | null; error: string | null }[] = [];

  for (const zone of zones) {
    try {
      const cmd = await createCommand(
        zone.zoneId,
        "on",
        zone.defaultDurationMinutes,
        "manual"
      );
      results.push({
        zoneId: zone.zoneId,
        commandId: (cmd as any)._id?.toString() ?? null,
        error: null
      });
    } catch (err: any) {
      results.push({
        zoneId: zone.zoneId,
        commandId: null,
        error: err?.message ?? "Unknown error"
      });
    }
  }

  emitRealtimeEvent({ type: "manualRun:completed", payload: { results } });

  return results;
};
