import SequentialRun from "../models/SequentialRun";
import type { SequentialRunSource, SequentialRunZoneEntry } from "../models/SequentialRun";
import Zone from "../models/Zone";
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

  const zoneDoc = await Zone.findOne({ zoneId: zone.zoneId }).select({ enabled: 1 }).lean();
  if (zoneDoc && !zoneDoc.enabled) {
    zone.status = "skipped";
    zone.completedAt = new Date();
    zone.error = "Zone is disabled";
    run.currentZoneIndex = index;
    await run.save();
    emitProgress(serializeRun(run.toObject()), run.source);
    await advanceToNextZone();
    return;
  }

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
  if (!run || (run.status !== "running" && run.status !== "deferred")) {
    activeRun = null;
    return;
  }

  if (run.status === "deferred") return;

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

  for (const zone of run.zones) {
    if (zone.status === "queued" || zone.status === "activating" || zone.status === "deferred") {
      zone.status = "skipped";
      zone.completedAt = new Date();
    }
  }

  const anyFailed = run.zones.some((z) => z.status === "failed");
  run.status = anyFailed ? "failed" : "completed";
  if (anyFailed) {
    const failedZone = run.zones.find((z) => z.status === "failed");
    run.statusReason = failedZone?.error ?? "One or more zones failed";
  }
  run.completedAt = new Date();
  await run.save();

  emitRealtimeEvent({
    type: "sequentialRun:completed",
    payload: { ...serializeRun(run.toObject()), source: run.source }
  });

  if (run.programId && run.source === "ai-schedule") {
    const { default: IrrigationProgram } = await import("../models/IrrigationProgram");
    const newStatus = anyFailed ? "skipped" : "completed";
    const update: Record<string, unknown> = { status: newStatus, updatedAt: new Date() };
    if (anyFailed) {
      update.statusReason = run.statusReason ?? "One or more zones failed during execution";
    }
    await IrrigationProgram.updateOne(
      { programId: run.programId, source: "ai-schedule", status: "executing" },
      { $set: update }
    );
  }

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

// A zone scheduled to run for minutes that reports "off" within seconds is almost
// always a controller echo/flap on startup (e.g. CompAI's inUse/active settling),
// not a real completion. Advancing on it makes the zone "run for a few instants".
export const MIN_LEGIT_RUNTIME_MS = 30_000;

// Pure decision helper (exported for testing): should an incoming "off" for the
// current zone be treated as spurious and ignored? Only very-early offs on a zone
// with a non-trivial planned duration are suppressed — a genuine early stop from
// CompAI (the source of truth) past the floor is still honored.
export const isPrematureOff = (
  durationMinutes: number | undefined,
  startedAt: Date | string | null | undefined,
  now: number = Date.now()
): boolean => {
  const plannedMs = (durationMinutes ?? 0) * 60_000;
  if (plannedMs < 60_000) return false; // short/unknown planned runs: trust the off
  if (!startedAt) return false;
  const elapsed = now - new Date(startedAt).getTime();
  return elapsed >= 0 && elapsed < MIN_LEGIT_RUNTIME_MS;
};

// Should an incoming "off" for this zone be dropped entirely (not even recorded as an
// event)? True only when there is an active, running run whose current zone is this one
// and it just started — i.e. a spurious controller echo. Recording such an off would both
// truncate the run AND poison the webhook de-dup so the *real* off later gets swallowed,
// so the decision has to happen before the event is persisted (see persistEvent).
export const isSpuriousOffForActiveRun = async (zoneId: string): Promise<boolean> => {
  if (!activeRun) return false;
  const run = await SequentialRun.findById(activeRun.runId);
  if (!run || run.status !== "running") return false;
  const z = run.zones[activeRun.currentZoneIndex];
  if (!z || z.zoneId !== zoneId || z.status !== "running") return false;
  return isPrematureOff(z.durationMinutes, z.startedAt);
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

  if (isPrematureOff(currentZone.durationMinutes, currentZone.startedAt)) {
    const elapsed = currentZone.startedAt
      ? Math.round((Date.now() - new Date(currentZone.startedAt).getTime()) / 1000)
      : 0;
    console.warn(
      `[SequentialRun] Ignoring premature off for zone ${zoneId} after ${elapsed}s ` +
      `(planned ${currentZone.durationMinutes}m) — treating as a spurious controller echo. ` +
      `Auto-off / CompAI duration timer / safety timeout will govern real completion.`
    );
    return;
  }

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
  if (currentZone && (currentZone.status === "running" || currentZone.status === "activating" || currentZone.status === "deferred")) {
    if (currentZone.status !== "deferred") {
      try {
        await createCommand(currentZone.zoneId, "off", undefined, run.source);
      } catch { /* best effort */ }
    }
    currentZone.status = "skipped";
    currentZone.completedAt = new Date();
    currentZone.error = "Run cancelled";
  }

  for (const zone of run.zones) {
    if (zone.status === "queued" || zone.status === "deferred" || zone.status === "activating") {
      zone.status = "skipped";
      zone.completedAt = new Date();
      zone.error = "Run cancelled";
    }
  }

  run.status = "cancelled";
  run.statusReason = "Manually cancelled by user";
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

export const getActiveRun = () => activeRun;

export const clearActiveRun = () => {
  clearSafetyTimeout();
  activeRun = null;
};

export const cleanupOrphanedRuns = async (): Promise<number> => {
  const orphaned = await SequentialRun.find({ status: { $in: ["running", "deferred"] } });
  let cleaned = 0;
  for (const run of orphaned) {
    for (const zone of run.zones) {
      if (zone.status === "queued" || zone.status === "deferred" || zone.status === "activating" || zone.status === "running") {
        zone.status = "skipped";
        zone.completedAt = new Date();
        zone.error = "Run orphaned during server restart";
      }
    }
    run.status = "failed";
    run.statusReason = "Run orphaned during server restart";
    run.completedAt = new Date();
    await run.save();
    cleaned++;
  }
  if (cleaned > 0) {
    console.log(`[SequentialRun] Cleaned up ${cleaned} orphaned run(s) from before restart`);
  }
  return cleaned;
};

const DEFERRAL_SAFETY_CAP_MS = 24 * 60 * 60_000;

export const deferCurrentZone = async (): Promise<boolean> => {
  if (!activeRun) return false;

  const run = await SequentialRun.findById(activeRun.runId);
  if (!run || run.status !== "running") return false;

  const currentZone = run.zones[activeRun.currentZoneIndex];
  if (!currentZone || (currentZone.status !== "running" && currentZone.status !== "activating")) return false;

  if (currentZone.status === "running") {
    try {
      await createCommand(currentZone.zoneId, "off", undefined, run.source);
    } catch { /* best effort */ }
  }

  currentZone.status = "deferred";
  run.status = "deferred";
  run.statusReason = "Guard activated — conditions not suitable for irrigation";
  run.deferredAt = new Date();
  run.deferralDeadline = new Date(Date.now() + DEFERRAL_SAFETY_CAP_MS);
  await run.save();

  clearSafetyTimeout();
  emitProgress(serializeRun(run.toObject()), run.source);

  return true;
};

export const resumeDeferredRun = async (runIdOverride?: string): Promise<boolean> => {
  const runId = runIdOverride ?? activeRun?.runId;
  if (!runId) return false;

  const run = await SequentialRun.findById(runId);
  if (!run || run.status !== "deferred") return false;

  if (run.deferralDeadline && new Date(run.deferralDeadline) <= new Date()) return false;

  const deferredIndex = run.zones.findIndex((z) => z.status === "deferred");
  if (deferredIndex === -1) return false;

  run.status = "running";
  run.statusReason = null;
  run.deferredAt = null;
  run.deferralDeadline = null;
  run.zones[deferredIndex]!.status = "queued";
  await run.save();

  if (!activeRun) {
    activeRun = {
      runId: run._id.toString(),
      source: run.source,
      programId: run.programId ?? undefined,
      currentZoneIndex: deferredIndex,
      timeoutTimer: null
    };
  }

  emitRealtimeEvent({
    type: "sequentialRun:zoneProgress",
    payload: { ...serializeRun(run.toObject()), source: run.source }
  });

  await startZone(run, deferredIndex);

  return true;
};
