import Zone from "../models/Zone";
import type { CreateZoneInput, UpdateZoneInput } from "../schemas/zoneSchema";
import IrrigationEvent from "../models/IrrigationEvent";
import IrrigationCommand from "../models/IrrigationCommand";
import IrrigationRecord from "../models/IrrigationRecord";

export interface ZoneState {
  zoneId: string;
  isActive: boolean;
  lastAction: "on" | "off" | null;
  lastEventAt: string | null;
  activeCommandId?: string | null;
  activeDurationMinutes?: number | null;
  remainingSeconds?: number | null;
  remainingUpdatedAt?: string | null;
}

const serializeZone = (doc: Record<string, unknown>) => {
  const { _id, __v, ...rest } = doc;
  return { _id, ...rest };
};

export const listZones = async () => {
  const zones = await Zone.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
  return zones.map(serializeZone);
};

export const getZone = async (zoneId: string) => {
  const zone = await Zone.findOne({ zoneId }).lean();
  return zone ? serializeZone(zone) : null;
};

export const createZone = async (input: CreateZoneInput) => {
  const doc = await Zone.create({
    ...input,
    enabled: input.enabled ?? true,
    sortOrder: input.sortOrder ?? 0,
    maxDurationMinutes: input.maxDurationMinutes ?? 60,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  return serializeZone(doc.toObject());
};

export const updateZone = async (zoneId: string, input: UpdateZoneInput) => {
  const doc = await Zone.findOneAndUpdate(
    { zoneId },
    { $set: { ...input, updatedAt: new Date() } },
    { new: true }
  ).lean();
  return doc ? serializeZone(doc) : null;
};

export const deleteZone = async (zoneId: string) => {
  const result = await Zone.deleteOne({ zoneId });
  return result.deletedCount > 0;
};

export const toggleZone = async (zoneId: string) => {
  const zone = await Zone.findOne({ zoneId });
  if (!zone) return null;

  zone.enabled = !zone.enabled;
  zone.updatedAt = new Date();
  await zone.save();
  return serializeZone(zone.toObject());
};

export const reorderZones = async (order: Array<{ zoneId: string; sortOrder: number }>) => {
  const ops = order.map(({ zoneId, sortOrder }) => ({
    updateOne: {
      filter: { zoneId },
      update: { $set: { sortOrder, updatedAt: new Date() } }
    }
  }));
  await Zone.bulkWrite(ops);
  return listZones();
};

export const getZoneState = async (zoneId: string): Promise<ZoneState> => {
  const latest = await IrrigationEvent.findOne({ zone: zoneId })
    .sort({ createdAt: -1 })
    .lean();

  const isActive = latest?.action === "on";

  let activeCommandId: string | null = null;
  let activeDurationMinutes: number | null = null;
  let remainingSeconds: number | null = null;
  let remainingUpdatedAt: string | null = null;

  if (isActive && latest?.commandId) {
    const cmd = await IrrigationCommand.findById(latest.commandId)
      .select({ durationMinutes: 1 })
      .lean();
    if (cmd) {
      activeCommandId = latest.commandId.toString();
      activeDurationMinutes = cmd.durationMinutes ?? null;
    }
  }

  if (isActive) {
    const runningRecord = await IrrigationRecord.findOne({
      zoneId,
      status: "running"
    })
      .sort({ startedAt: -1 })
      .select({ remainingSeconds: 1, remainingUpdatedAt: 1 })
      .lean();

    if (runningRecord?.remainingSeconds != null && runningRecord.remainingUpdatedAt) {
      remainingSeconds = runningRecord.remainingSeconds;
      remainingUpdatedAt = runningRecord.remainingUpdatedAt.toISOString();
    }
  }

  return {
    zoneId,
    isActive,
    lastAction: latest?.action ?? null,
    lastEventAt: latest?.createdAt?.toISOString() ?? null,
    activeCommandId,
    activeDurationMinutes,
    remainingSeconds,
    remainingUpdatedAt
  };
};

export const getAllZoneStates = async (): Promise<ZoneState[]> => {
  const zones = await Zone.find().select({ zoneId: 1 }).lean();
  const states = await Promise.all(
    zones.map((z) => getZoneState(z.zoneId))
  );
  return states;
};
