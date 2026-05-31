import IrrigationEvent from "../models/IrrigationEvent";
import IrrigationRecord from "../models/IrrigationRecord";
import type { IrrigationSource } from "../models/IrrigationRecord";
import { emitRealtimeEvent } from "./realtimeService";
import { refreshStatusCache } from "../controllers/statusController";
import { acknowledgeCommand } from "./irrigationCommandService";
import { onZoneOff } from "./sequentialRunService";
import { getZoneState } from "./zoneService";
import Heartbeat from "../models/Heartbeat";
import Zone from "../models/Zone";

export const resolveZoneId = async (input: string): Promise<string> => {
  const byId = await Zone.findOne({ zoneId: input }).lean();
  if (byId) return byId.zoneId;

  const byName = await Zone.findOne({
    name: { $regex: new RegExp(`^${input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }
  }).lean();
  if (byName) return byName.zoneId;

  return input;
};

export const serializeEvent = (event: {
  _id?: unknown;
  zone: string;
  action: "on" | "off";
  createdAt?: Date;
  waterPressure?: number | null;
  commandId?: unknown;
  source?: string | null;
}) => ({
  _id: (event as { _id?: unknown })._id ?? undefined,
  zone: event.zone,
  action: event.action,
  waterPressure: event.waterPressure ?? null,
  commandId: event.commandId ?? null,
  source: event.source ?? null,
  createdAt: event.createdAt ?? undefined
});

export const persistEvent = async (zone: string, action: "on" | "off") => {
  const now = new Date();
  const zoneId = await resolveZoneId(zone.trim());

  const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
  const pressure = latestHeartbeat?.sensors?.waterPsi ?? null;

  const acknowledgedCmd = await acknowledgeCommand(zoneId, action);

  const event = await IrrigationEvent.create({
    zone: zoneId,
    action,
    waterPressure: pressure,
    commandId: acknowledgedCmd?._id ?? null,
    source: acknowledgedCmd ? acknowledgedCmd.source : "external",
    createdAt: now
  });

  try {
    if (action === "on") {
      const cmdSource = acknowledgedCmd?.source;
      let recordSource: IrrigationSource = "manual";
      if (cmdSource === "program") recordSource = "program";
      else if (cmdSource === "ai-schedule") recordSource = "ai-schedule";
      else if (cmdSource === "schedule") recordSource = "program";

      const durationMinutes = acknowledgedCmd?.durationMinutes ?? null;
      const remainingSeconds = durationMinutes != null && durationMinutes > 0
        ? durationMinutes * 60
        : null;

      await IrrigationRecord.create({
        zoneId,
        source: recordSource,
        status: "running",
        startedAt: now,
        pressureStart: pressure,
        remainingSeconds,
        remainingUpdatedAt: remainingSeconds != null ? now : null,
        commandId: acknowledgedCmd?._id ?? null,
        createdAt: now
      });
    } else if (action === "off") {
      const runningRecord = await IrrigationRecord.findOne({
        zoneId,
        status: "running"
      }).sort({ startedAt: -1 });

      if (runningRecord) {
        runningRecord.endedAt = now;
        runningRecord.durationMs = now.getTime() - runningRecord.startedAt.getTime();
        runningRecord.pressureEnd = pressure;
        runningRecord.status = "completed";
        await runningRecord.save();
      }

      void onZoneOff(zoneId);
    }
  } catch (err) {
    console.error("Failed to update irrigation record:", err);
  }

  let refreshedStatus = null;
  try {
    refreshedStatus = await refreshStatusCache();
  } catch (error) {
    console.error("Failed to refresh status after irrigation event:", error);
  }

  emitRealtimeEvent({
    type: "irrigation:updated",
    payload: serializeEvent(event)
  });

  if (refreshedStatus) {
    emitRealtimeEvent({
      type: "status:updated",
      payload: refreshedStatus
    });
  }

  const finalState = await getZoneState(zoneId);
  emitRealtimeEvent({ type: "zoneState:changed", payload: finalState });

  return event;
};
