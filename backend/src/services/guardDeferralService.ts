import SequentialRun from "../models/SequentialRun";
import ScheduleEntry from "../models/ScheduleEntry";
import Heartbeat from "../models/Heartbeat";
import { emitRealtimeEvent } from "./realtimeService";
import {
  getActiveRun,
  deferCurrentZone,
  resumeDeferredRun
} from "./sequentialRunService";
import { isWithinPreferredWindow } from "./irrigationSettingsService";

interface DeferredProgramEntry {
  programId: string;
  deferredAt: Date;
  deadline: Date;
  zoneEntries: { zoneId: string; durationMinutes: number }[];
}

let monitorActive = false;
let lastGuardState: boolean | null = null;
const deferredPrograms = new Map<string, DeferredProgramEntry>();

export const isGuardDeferralActive = () => monitorActive;

export const getDeferredPrograms = () => deferredPrograms;

export const addDeferredProgram = (entry: DeferredProgramEntry) => {
  deferredPrograms.set(entry.programId, entry);
};

const onGuardActivated = async () => {
  const active = getActiveRun();
  if (active) {
    const success = await deferCurrentZone();
    if (success) {
      const run = await SequentialRun.findById(active.runId).lean();
      emitRealtimeEvent({
        type: "deferral:triggered",
        payload: {
          type: "sequential-run",
          runId: active.runId,
          reason: "Guard activated — conditions not suitable for irrigation",
          deadline: run?.deferralDeadline?.toISOString() ?? null
        }
      });
    }
  }
};

const resumeDeferredTasks = async () => {
  const active = getActiveRun();
  if (active) {
    const run = await SequentialRun.findById(active.runId).lean();
    if (run?.status === "deferred" && run.deferralDeadline && new Date(run.deferralDeadline) > new Date()) {
      const success = await resumeDeferredRun();
      if (success) {
        emitRealtimeEvent({
          type: "deferral:recovered",
          payload: {
            type: "sequential-run",
            runId: active.runId
          }
        });
      }
    }
  } else {
    const deferredRun = await SequentialRun.findOne({
      status: "deferred",
      deferralDeadline: { $gt: new Date() }
    });
    if (deferredRun) {
      const success = await resumeDeferredRun(deferredRun._id.toString());
      if (success) {
        emitRealtimeEvent({
          type: "deferral:recovered",
          payload: {
            type: "sequential-run",
            runId: deferredRun._id.toString()
          }
        });
      }
    }
  }

  const now = new Date();
  const deferredEntries = await ScheduleEntry.find({
    status: "deferred",
    deferralDeadline: { $gt: now }
  });

  for (const entry of deferredEntries) {
    entry.status = "planned";
    entry.deferralReason = null;
    entry.updatedAt = new Date();
    await entry.save();
    emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
    emitRealtimeEvent({
      type: "deferral:recovered",
      payload: {
        type: "schedule-entry",
        entryId: entry._id.toString(),
        zoneId: entry.zoneId
      }
    });
  }

  for (const [programId, deferred] of deferredPrograms) {
    if (deferred.deadline > now) {
      const { startSequentialRun } = await import("./sequentialRunService");
      const { default: Zone } = await import("../models/Zone");
      const { getWaterSavingFactor } = await import("./irrigationSettingsService");

      const factor = await getWaterSavingFactor();
      const zoneIds = deferred.zoneEntries.map((e) => e.zoneId);
      const zones = await Zone.find({ zoneId: { $in: zoneIds } }).lean();
      const nameMap = new Map(zones.map((z) => [z.zoneId, z.name]));

      const inputs = deferred.zoneEntries.map((e) => ({
        zoneId: e.zoneId,
        name: nameMap.get(e.zoneId) ?? e.zoneId,
        durationMinutes: Math.max(1, Math.round(e.durationMinutes * factor))
      }));

      try {
        await startSequentialRun(inputs, "program", programId);
        emitRealtimeEvent({
          type: "deferral:recovered",
          payload: { type: "deferred-program", programId }
        });
      } catch (err) {
        console.error(`[GuardDeferral] Failed to start deferred program ${programId}:`, err);
      }
    }
    deferredPrograms.delete(programId);
  }
};

const onGuardDeactivated = async () => {
  const inWindow = await isWithinPreferredWindow(new Date());
  if (inWindow) {
    await resumeDeferredTasks();
  }
};

const hasDeferredTasks = async (): Promise<boolean> => {
  if (deferredPrograms.size > 0) return true;

  const active = getActiveRun();
  if (active) {
    const run = await SequentialRun.findById(active.runId).lean();
    if (run?.status === "deferred") return true;
  }

  const deferredRun = await SequentialRun.findOne({ status: "deferred", deferralDeadline: { $gt: new Date() } });
  if (deferredRun) return true;

  const deferredEntry = await ScheduleEntry.findOne({ status: "deferred", deferralDeadline: { $gt: new Date() } });
  if (deferredEntry) return true;

  return false;
};

const checkDeadlines = async () => {
  const now = new Date();

  const expiredRun = await SequentialRun.findOne({
    status: "deferred",
    deferralDeadline: { $lte: now }
  });

  if (expiredRun) {
    for (const zone of expiredRun.zones) {
      if (zone.status === "queued" || zone.status === "deferred") {
        zone.status = "skipped";
        zone.completedAt = now;
        zone.error = "Deferral deadline expired — guard did not clear in time";
      }
    }
    expiredRun.status = "failed";
    expiredRun.completedAt = now;
    await expiredRun.save();

    emitRealtimeEvent({
      type: "deferral:expired",
      payload: {
        type: "sequential-run",
        runId: expiredRun._id.toString(),
        reason: "Deferral deadline expired — guard did not clear in time"
      }
    });
    emitRealtimeEvent({
      type: "sequentialRun:completed",
      payload: expiredRun.toObject()
    });

    const { clearActiveRun } = await import("./sequentialRunService");
    clearActiveRun();
  }

  const expiredEntries = await ScheduleEntry.find({
    status: "deferred",
    deferralDeadline: { $lte: now }
  });

  for (const entry of expiredEntries) {
    entry.status = "skipped";
    entry.skipReason = "Deferral deadline expired — guard did not clear in time";
    entry.updatedAt = now;
    await entry.save();
    emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
    emitRealtimeEvent({
      type: "deferral:expired",
      payload: {
        type: "schedule-entry",
        entryId: entry._id.toString(),
        reason: "Deferral deadline expired"
      }
    });
  }

  for (const [programId, deferred] of deferredPrograms) {
    if (deferred.deadline <= now) {
      deferredPrograms.delete(programId);
      emitRealtimeEvent({
        type: "deferral:expired",
        payload: {
          type: "deferred-program",
          programId,
          reason: "Deferral deadline expired — guard did not clear in time"
        }
      });
    }
  }
};

export const handleHeartbeatForDeferral = async (heartbeat: { guard: boolean }) => {
  if (!monitorActive) return;

  const currentGuard = heartbeat.guard;
  const previousGuard = lastGuardState;
  lastGuardState = currentGuard;

  if (previousGuard === null) return;

  try {
    if (currentGuard === true && previousGuard === false) {
      await onGuardActivated();
    }

    if (currentGuard === false && previousGuard === true) {
      await onGuardDeactivated();
    }

    if (currentGuard === true) {
      await checkDeadlines();
    }

    // When guard is off but deferred tasks exist, check if we've entered a preferred window
    if (currentGuard === false && await hasDeferredTasks()) {
      const inWindow = await isWithinPreferredWindow(new Date());
      if (inWindow) {
        await resumeDeferredTasks();
      }
    }
  } catch (err) {
    console.error("[GuardDeferral] Error handling heartbeat:", err);
  }
};

export const startGuardDeferralMonitor = async () => {
  monitorActive = true;
  lastGuardState = null;
  deferredPrograms.clear();

  try {
    const latest = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
    if (latest) {
      lastGuardState = latest.guard;
    }
  } catch (err) {
    console.error("[GuardDeferral] Failed to read initial guard state:", err);
  }

  try {
    const now = new Date();
    const deferredRun = await SequentialRun.findOne({
      status: "deferred",
      deferralDeadline: { $gt: now }
    });
    if (deferredRun) {
      console.log(`[GuardDeferral] Found deferred run ${deferredRun._id} from before restart`);
    }

    const expiredRuns = await SequentialRun.find({
      status: "deferred",
      deferralDeadline: { $lte: now }
    });
    for (const run of expiredRuns) {
      for (const zone of run.zones) {
        if (zone.status === "queued" || zone.status === "deferred") {
          zone.status = "skipped";
          zone.completedAt = now;
          zone.error = "Deferral deadline expired during server restart";
        }
      }
      run.status = "failed";
      run.completedAt = now;
      await run.save();
      console.log(`[GuardDeferral] Expired deferred run ${run._id} from before restart`);
    }
  } catch (err) {
    console.error("[GuardDeferral] Failed startup recovery:", err);
  }

  console.log("[GuardDeferral] Monitor started");
};

export const stopGuardDeferralMonitor = () => {
  monitorActive = false;
  lastGuardState = null;
  deferredPrograms.clear();
  console.log("[GuardDeferral] Monitor stopped");
};
