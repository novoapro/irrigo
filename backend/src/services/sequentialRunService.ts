import SequentialRun from "../models/SequentialRun";
import type { SequentialRunSource, SequentialRunZoneEntry } from "../models/SequentialRun";
import { createCommand } from "./irrigationCommandService";
import { emitRealtimeEvent } from "./realtimeService";

const TIMEOUT_BUFFER_MINUTES = 2;

interface ActiveRun {
  runId: string;
  source: SequentialRunSource;
  programId?: string;
  currentZoneIndex: number;
  timeoutTimer: NodeJS.Timeout | null;
}

let activeRun: ActiveRun | null = null;

const serializeRun = (doc: Record<string, unknown>) => {
  const { __v, ...rest } = doc;
  return rest;
};

const emitProgress = (run: Record<string, unknown>, source: SequentialRunSource) => {
  emitRealtimeEvent({
    type: "sequentialRun:zoneProgress",
    payload: { ...run, source }
  });
};

const clearSafetyTimeout = () => {
  if (activeRun?.timeoutTimer) {
    clearTimeout(activeRun.timeoutTimer);
    activeRun.timeoutTimer = null;
  }
};

const setSafetyTimeout = (zoneId: string, durationMinutes: number) => {
  clearSafetyTimeout();
  if (!activeRun) return;

  const ms = (durationMinutes + TIMEOUT_BUFFER_MINUTES) * 60_000;
  activeRun.timeoutTimer = setTimeout(async () => {
    console.warn(`[SequentialRun] Safety timeout for zone ${zoneId} after ${durationMinutes + TIMEOUT_BUFFER_MINUTES}m — forcing advance`);
    try {
      await createCommand(zoneId, "off", undefined, activeRun?.source ?? "manual");
    } catch { /* best effort */ }
    await advanceToNextZone();
  }, ms);
};

const startZone = async (run: InstanceType<typeof SequentialRun>, index: number) => {
  const zone = run.zones[index]!;

  zone.status = "activating";
  zone.startedAt = new Date();
  run.currentZoneIndex = index;
  await run.save();
  emitProgress(serializeRun(run.toObject()), run.source);

  try {
    const cmd = await createCommand(zone.zoneId, "on", zone.durationMinutes, run.source);
    zone.commandId = (cmd as any)._id?.toString() ?? null;
    zone.status = "running";
    await run.save();
    emitProgress(serializeRun(run.toObject()), run.source);

    if (activeRun) {
      activeRun.currentZoneIndex = index;
    }
    setSafetyTimeout(zone.zoneId, zone.durationMinutes);
  } catch (err: any) {
    zone.status = "failed";
    zone.completedAt = new Date();
    zone.error = err?.message ?? "Unknown error";
    await run.save();
    emitProgress(serializeRun(run.toObject()), run.source);
    await advanceToNextZone();
  }
};

const advanceToNextZone = async () => {
  if (!activeRun) return;
  clearSafetyTimeout();

  const run = await SequentialRun.findById(activeRun.runId);
  if (!run || run.status !== "running") {
    activeRun = null;
    return;
  }

  const currentZone = run.zones[activeRun.currentZoneIndex];
  if (currentZone && currentZone.status === "running") {
    currentZone.status = "completed";
    currentZone.completedAt = new Date();
    await run.save();
    emitProgress(serializeRun(run.toObject()), run.source);
  }

  const nextIndex = activeRun.currentZoneIndex + 1;
  if (nextIndex < run.zones.length) {
    await startZone(run, nextIndex);
  } else {
    await finalizeRun(run);
  }
};

const finalizeRun = async (run: InstanceType<typeof SequentialRun>) => {
  clearSafetyTimeout();
  const anyFailed = run.zones.some((z) => z.status === "failed");
  run.status = anyFailed ? "failed" : "completed";
  run.completedAt = new Date();
  await run.save();

  emitRealtimeEvent({
    type: "sequentialRun:completed",
    payload: { ...serializeRun(run.toObject()), source: run.source }
  });

  activeRun = null;
};

export interface StartRunZoneInput {
  zoneId: string;
  name: string;
  durationMinutes: number;
}

export const startSequentialRun = async (
  zones: StartRunZoneInput[],
  source: SequentialRunSource,
  programId?: string
): Promise<string> => {
  if (activeRun) {
    throw new Error("A sequential run is already in progress");
  }

  if (zones.length === 0) {
    throw new Error("No zones provided");
  }

  const zoneEntries: SequentialRunZoneEntry[] = zones.map((z) => ({
    zoneId: z.zoneId,
    name: z.name,
    durationMinutes: z.durationMinutes,
    status: "queued" as const
  }));

  const run = await SequentialRun.create({
    source,
    programId: programId ?? null,
    status: "running",
    zones: zoneEntries,
    currentZoneIndex: 0,
    startedAt: new Date()
  });

  const runId = run._id.toString();

  activeRun = {
    runId,
    source,
    programId,
    currentZoneIndex: 0,
    timeoutTimer: null
  };

  emitRealtimeEvent({
    type: "sequentialRun:started",
    payload: { ...serializeRun(run.toObject()), source }
  });

  await startZone(run, 0);

  return runId;
};

export const onZoneOff = async (zoneId: string) => {
  if (!activeRun) return;

  const run = await SequentialRun.findById(activeRun.runId);
  if (!run || run.status !== "running") {
    activeRun = null;
    return;
  }

  const currentZone = run.zones[activeRun.currentZoneIndex];
  if (!currentZone || currentZone.zoneId !== zoneId) return;
  if (currentZone.status !== "running") return;

  await advanceToNextZone();
};

export const cancelRun = async (): Promise<boolean> => {
  if (!activeRun) return false;
  clearSafetyTimeout();

  const run = await SequentialRun.findById(activeRun.runId);
  if (!run) {
    activeRun = null;
    return false;
  }

  const currentZone = run.zones[activeRun.currentZoneIndex];
  if (currentZone && (currentZone.status === "running" || currentZone.status === "activating")) {
    try {
      await createCommand(currentZone.zoneId, "off", undefined, run.source);
    } catch { /* best effort */ }
    currentZone.status = "skipped";
    currentZone.completedAt = new Date();
    currentZone.error = "Run cancelled";
  }

  for (let i = activeRun.currentZoneIndex + 1; i < run.zones.length; i++) {
    if (run.zones[i]!.status === "queued") {
      run.zones[i]!.status = "skipped";
    }
  }

  run.status = "cancelled";
  run.completedAt = new Date();
  await run.save();

  emitRealtimeEvent({
    type: "sequentialRun:cancelled",
    payload: { ...serializeRun(run.toObject()), source: run.source }
  });

  activeRun = null;
  return true;
};

export const getRunStatus = async () => {
  if (activeRun) {
    const run = await SequentialRun.findById(activeRun.runId).lean();
    if (run) return serializeRun(run as Record<string, unknown>);
  }

  const latest = await SequentialRun.findOne()
    .sort({ startedAt: -1 })
    .lean();
  return latest ? serializeRun(latest as Record<string, unknown>) : null;
};

export const isRunActive = (): boolean => activeRun !== null;
