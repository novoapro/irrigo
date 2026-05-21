import Zone from "../models/Zone";
import ManualRun from "../models/ManualRun";
import type { ManualRunZoneEntry } from "../models/ManualRun";
import { createCommand } from "./irrigationCommandService";
import { emitRealtimeEvent } from "./realtimeService";

let abortController: AbortController | null = null;
let activeRunId: string | null = null;

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    }, { once: true });
  });

const emitProgress = (run: Record<string, unknown>) => {
  emitRealtimeEvent({ type: "manualRun:zoneProgress", payload: run });
};

const serializeRun = (doc: Record<string, unknown>) => {
  const { __v, ...rest } = doc;
  return rest;
};

export const runAllZones = async (
  zoneOverrides?: { zoneId: string; durationMinutes: number }[]
): Promise<string> => {
  if (activeRunId) {
    throw new Error("A manual run is already in progress");
  }

  const zones = await Zone.find({
    enabled: true,
    excludeFromManualRun: { $ne: true }
  }).sort({ sortOrder: 1 }).lean();

  if (zones.length === 0) throw new Error("No eligible zones for manual run");

  const overrideMap = new Map(
    (zoneOverrides ?? []).map((o) => [o.zoneId, o.durationMinutes])
  );

  const zoneEntries: ManualRunZoneEntry[] = zones.map((z) => ({
    zoneId: z.zoneId,
    name: z.name,
    durationMinutes: overrideMap.get(z.zoneId) ?? z.defaultDurationMinutes,
    status: "queued" as const
  }));

  const run = await ManualRun.create({
    status: "running",
    zones: zoneEntries,
    currentZoneIndex: 0,
    startedAt: new Date()
  });

  activeRunId = run._id.toString();
  abortController = new AbortController();
  const signal = abortController.signal;

  emitRealtimeEvent({
    type: "manualRun:started",
    payload: serializeRun(run.toObject())
  });

  void executeSequence(run._id.toString(), signal);

  return run._id.toString();
};

const executeSequence = async (runId: string, signal: AbortSignal) => {
  try {
    const run = await ManualRun.findById(runId);
    if (!run) return;

    for (let i = 0; i < run.zones.length; i++) {
      if (signal.aborted) break;

      const zone = run.zones[i];
      run.currentZoneIndex = i;

      zone.status = "activating";
      zone.startedAt = new Date();
      await run.save();
      emitProgress(serializeRun(run.toObject()));

      try {
        const cmd = await createCommand(
          zone.zoneId,
          "on",
          zone.durationMinutes,
          "manual"
        );

        zone.commandId = (cmd as any)._id?.toString() ?? null;
        zone.status = "running";
        await run.save();
        emitProgress(serializeRun(run.toObject()));

        await sleep(zone.durationMinutes * 60_000, signal);

        await createCommand(zone.zoneId, "off", undefined, "manual");

        zone.status = "completed";
        zone.completedAt = new Date();
        await run.save();
        emitProgress(serializeRun(run.toObject()));
      } catch (err: any) {
        if (err?.message === "cancelled") {
          try {
            await createCommand(zone.zoneId, "off", undefined, "manual");
          } catch { /* best effort */ }
          zone.status = "skipped";
          zone.completedAt = new Date();
          zone.error = "Run cancelled";
          await run.save();
          break;
        }
        try {
          await createCommand(zone.zoneId, "off", undefined, "manual");
        } catch { /* best effort */ }
        zone.status = "failed";
        zone.completedAt = new Date();
        zone.error = err?.message ?? "Unknown error";
        await run.save();
        emitProgress(serializeRun(run.toObject()));
      }
    }

    const finalRun = await ManualRun.findById(runId);
    if (!finalRun) return;

    if (signal.aborted) {
      for (const z of finalRun.zones) {
        if (z.status === "queued") z.status = "skipped";
      }
      finalRun.status = "cancelled";
    } else {
      const anyFailed = finalRun.zones.some((z) => z.status === "failed");
      finalRun.status = anyFailed ? "failed" : "completed";
    }

    finalRun.completedAt = new Date();
    await finalRun.save();

    const eventType = finalRun.status === "cancelled"
      ? "manualRun:cancelled"
      : "manualRun:completed";
    emitRealtimeEvent({
      type: eventType,
      payload: serializeRun(finalRun.toObject())
    });
  } catch (err) {
    console.error("Manual run sequence error:", err);
    try {
      await ManualRun.findByIdAndUpdate(runId, {
        $set: { status: "failed", completedAt: new Date() }
      });
    } catch { /* best effort */ }
  } finally {
    activeRunId = null;
    abortController = null;
  }
};

export const cancelManualRun = async (): Promise<boolean> => {
  if (!abortController || !activeRunId) return false;
  abortController.abort();
  return true;
};

export const getManualRunStatus = async () => {
  if (activeRunId) {
    const run = await ManualRun.findById(activeRunId).lean();
    if (run) return serializeRun(run as Record<string, unknown>);
  }

  const latest = await ManualRun.findOne()
    .sort({ startedAt: -1 })
    .lean();
  return latest ? serializeRun(latest as Record<string, unknown>) : null;
};

export const isManualRunActive = (): boolean => activeRunId !== null;
