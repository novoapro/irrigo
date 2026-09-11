import SequentialRun from "../models/SequentialRun";
import ScheduleEntry from "../models/ScheduleEntry";
import IrrigationProgram from "../models/IrrigationProgram";
import Heartbeat from "../models/Heartbeat";
import { emitRealtimeEvent } from "./realtimeService";
import {
  getActiveRun,
  deferCurrentZone,
  resumeDeferredRun
} from "./sequentialRunService";
import { isWithinPreferredWindow } from "./irrigationSettingsService";
import { getRainPauseState } from "./guardService";

interface DeferredProgramEntry {
  programId: string;
  deferredAt: Date;
  deadline: Date;
  zoneEntries: { zoneId: string; durationMinutes: number }[];
}

const GUARD_GRACE_PERIOD_MS = 60_000;
// How long after a zone-attributed guard activation to wait before confirming whether
// the low pressure was the zone's own startup dip or a genuine supply problem.
const GUARD_CONFIRMATION_DELAY_MS = 60_000;

interface ZoneRef {
  runId: string;
  zoneIndex: number;
  zoneId: string;
}

let monitorActive = false;
let lastGuardState: boolean | null = null;
// Hardware guard tracked separately from the combined (hardware OR rain-pause) state:
// only hardware activations can be attributed to a running zone's own pressure dip.
let lastHardwareGuard: boolean | null = null;
const deferredPrograms = new Map<string, DeferredProgramEntry>();
let pendingGraceDeferral: { runId: string; zoneStartedAt: number } | null = null;
// A hardware guard activation attributed to the current zone that is awaiting its
// one confirmation heartbeat (~1 minute after the activation, forced from the device).
// While pending, the activation does not defer the run.
let pendingZoneConfirmation: (ZoneRef & { confirmAfter: number; forceTimer: NodeJS.Timeout | null }) | null = null;
// A zone that PASSED its confirmation check. Each zone is confirmed at most once —
// while set, further guard activations for this zone are ignored; it expires with the zone.
let suppressedZoneActivation: ZoneRef | null = null;

export const isGuardDeferralActive = () => monitorActive;

export const getLastKnownHardwareGuard = (): boolean | null => lastHardwareGuard;

const cancelPendingConfirmation = () => {
  if (pendingZoneConfirmation?.forceTimer) {
    clearTimeout(pendingZoneConfirmation.forceTimer);
  }
  pendingZoneConfirmation = null;
};

// Clears bookkeeping tied to a specific run (or all runs when omitted) so a finished or
// cancelled run leaves no deferral residue for future runs. Deliberately does NOT touch
// lastGuardState/lastHardwareGuard — those reflect world state, not run state.
export const clearRunScopedGuardState = (runId?: string) => {
  if (!runId || pendingGraceDeferral?.runId === runId) {
    pendingGraceDeferral = null;
  }
  if (!runId || pendingZoneConfirmation?.runId === runId) {
    cancelPendingConfirmation();
  }
  if (!runId || suppressedZoneActivation?.runId === runId) {
    suppressedZoneActivation = null;
  }
};

// Asks the sensor device for an out-of-cycle heartbeat: the device polls its config and
// sends a heartbeat when it sees forceHeartbeat=true (the flag auto-resets on fetch).
const requestForcedHeartbeat = async () => {
  try {
    const { default: DeviceConfig } = await import("../models/DeviceConfig");
    const config = await DeviceConfig.findOne().sort({ updatedAt: -1 }).lean();
    if (!config) return;
    await DeviceConfig.updateOne({ deviceIp: config.deviceIp }, { $set: { forceHeartbeat: true } });
    emitRealtimeEvent({ type: "forceHeartbeat:queued", payload: { deviceIp: config.deviceIp } });
    console.log("[GuardDeferral] Requested forced heartbeat to confirm zone pressure dip");
  } catch (err) {
    console.error("[GuardDeferral] Failed to request forced heartbeat:", err);
  }
};

export const getDeferredPrograms = () => deferredPrograms;

export const addDeferredProgram = (entry: DeferredProgramEntry) => {
  deferredPrograms.set(entry.programId, entry);
};

const deferActiveRun = async () => {
  const active = getActiveRun();
  if (!active) return;

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
};

// True while `ref` still points at the active run's current, running zone. Confirmation
// and pass-suppression are scoped to the zone they were attributed to — once that zone
// is no longer the current running zone, a still-active guard is real.
const zoneRefStillCurrent = async (ref: ZoneRef): Promise<boolean> => {
  const active = getActiveRun();
  if (!active || active.runId !== ref.runId) return false;
  if (active.currentZoneIndex !== ref.zoneIndex) return false;

  const run = await SequentialRun.findById(active.runId).lean();
  if (!run || run.status !== "running") return false;
  const zone = run.zones[active.currentZoneIndex];
  return Boolean(zone && (zone.status === "running" || zone.status === "activating"));
};

// A hardware guard that activates while a commanded zone is running — and was clear when
// the zone started — is likely the zone's own draw dropping line pressure below the
// device baseline. Instead of deferring, keep the zone running and schedule ONE
// confirmation: a forced heartbeat ~1 minute later decides whether the dip was startup
// noise (continue) or a real supply problem (defer). Returns true when the activation
// was attributed (confirmation started, or the zone already passed its confirmation).
const tryBeginZoneConfirmation = async (): Promise<boolean> => {
  const active = getActiveRun();
  if (!active) return false;
  // Guard already active when this zone started → not attributable to the zone.
  if ((active as { guardClearAtZoneStart?: boolean | null }).guardClearAtZoneStart === false) return false;

  const run = await SequentialRun.findById(active.runId).lean();
  if (!run || run.status !== "running") return false;
  const zone = run.zones[active.currentZoneIndex];
  if (!zone || (zone.status !== "running" && zone.status !== "activating") || !zone.startedAt) return false;

  // This zone already passed its one confirmation — stay quiet for its remainder.
  if (
    suppressedZoneActivation &&
    suppressedZoneActivation.runId === active.runId &&
    suppressedZoneActivation.zoneIndex === active.currentZoneIndex
  ) {
    return true;
  }
  suppressedZoneActivation = null; // stale entry from an earlier zone

  pendingZoneConfirmation = {
    runId: active.runId,
    zoneIndex: active.currentZoneIndex,
    zoneId: zone.zoneId,
    confirmAfter: Date.now() + GUARD_CONFIRMATION_DELAY_MS,
    forceTimer: setTimeout(() => {
      void requestForcedHeartbeat();
    }, GUARD_CONFIRMATION_DELAY_MS)
  };
  console.log(
    `[GuardDeferral] Guard rose after zone ${zone.zoneId} started — requesting a confirmation heartbeat in ${GUARD_CONFIRMATION_DELAY_MS / 1000}s before deciding`
  );
  return true;
};

const onGuardActivated = async () => {
  const active = getActiveRun();
  if (active) {
    const run = await SequentialRun.findById(active.runId).lean();
    const currentZone = run?.zones[active.currentZoneIndex];
    if (currentZone?.startedAt) {
      const elapsed = Date.now() - new Date(currentZone.startedAt).getTime();
      if (elapsed < GUARD_GRACE_PERIOD_MS) {
        pendingGraceDeferral = { runId: active.runId, zoneStartedAt: new Date(currentZone.startedAt).getTime() };
        console.log(`[GuardDeferral] Guard activated but zone started ${Math.round(elapsed / 1000)}s ago — within grace period, deferral pending`);
        return;
      }
    }

    await deferActiveRun();
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
    return;
  }

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
    return;
  }

  const now = new Date();

  const { isRunActive } = await import("./sequentialRunService");

  for (const [programId, deferred] of deferredPrograms) {
    if (isRunActive()) break;

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
        deferredPrograms.delete(programId);
        emitRealtimeEvent({
          type: "deferral:recovered",
          payload: { type: "deferred-program", programId }
        });
      } catch (err) {
        console.error(`[GuardDeferral] Failed to start deferred program ${programId}:`, err);
      }
    } else {
      deferredPrograms.delete(programId);
    }
  }

  if (!isRunActive()) {
    const deferredAIPrograms = await IrrigationProgram.find({
      source: "ai-schedule",
      status: "deferred",
      deferralDeadline: { $gt: now }
    }).sort({ plannedStartAt: 1 }).limit(1);

    for (const program of deferredAIPrograms) {
      program.status = "planned";
      program.deferredAt = undefined;
      program.deferralDeadline = undefined;
      program.updatedAt = new Date();
      await program.save();
      emitRealtimeEvent({
        type: "deferral:recovered",
        payload: { type: "ai-program", programId: program.programId }
      });
    }
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

  const deferredAIProgram = await IrrigationProgram.findOne({
    source: "ai-schedule",
    status: "deferred",
    deferralDeadline: { $gt: new Date() }
  });
  if (deferredAIProgram) return true;

  return false;
};

const checkDeadlines = async () => {
  const now = new Date();

  const expiredRun = await SequentialRun.findOne({
    status: "deferred",
    deferralDeadline: { $lte: now }
  });

  if (expiredRun) {
    const reason = "Deferral deadline expired — guard did not clear in time";
    for (const zone of expiredRun.zones) {
      if (zone.status === "queued" || zone.status === "deferred" || zone.status === "activating" || zone.status === "running") {
        zone.status = "skipped";
        zone.completedAt = now;
        zone.error = reason;
      }
    }
    expiredRun.status = "failed";
    expiredRun.statusReason = reason;
    expiredRun.completedAt = now;
    await expiredRun.save();

    emitRealtimeEvent({
      type: "deferral:expired",
      payload: {
        type: "sequential-run",
        runId: expiredRun._id.toString(),
        reason
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

  const expiredAIPrograms = await IrrigationProgram.find({
    source: "ai-schedule",
    status: "deferred",
    deferralDeadline: { $lte: now }
  });

  for (const program of expiredAIPrograms) {
    const reason = "Deferral deadline expired — guard did not clear in time";
    program.status = "skipped";
    program.statusReason = reason;
    program.updatedAt = now;
    await program.save();
    emitRealtimeEvent({
      type: "deferral:expired",
      payload: {
        type: "ai-program",
        programId: program.programId,
        reason
      }
    });
  }
};

export const handleHeartbeatForDeferral = async (heartbeat: {
  guard: boolean;
  sensors?: { waterPsi?: number | null } | null;
  device?: { baselinePsi?: number | null } | null;
}) => {
  if (!monitorActive) return;

  // The effective guard is hardware (heartbeat) OR rain pause (software). Treating both
  // as "the guard" here means deferred tasks won't resume while a rain pause is still
  // active, and a rain pause that becomes active will defer an in-flight run — the same
  // way a hardware guard does.
  const rainPause = await getRainPauseState();
  const hardwareGuard = heartbeat.guard;
  const currentGuard = hardwareGuard || rainPause.active;
  const previousGuard = lastGuardState;
  lastGuardState = currentGuard;
  lastHardwareGuard = hardwareGuard;

  if (previousGuard === null) return;

  // Set when this heartbeat itself defers the run, so the falling-edge resume logic
  // below can't immediately undo the deferral in the same invocation.
  let deferredThisHeartbeat = false;

  try {
    // Resolve an in-flight zone confirmation before anything else.
    if (pendingZoneConfirmation) {
      if (!(await zoneRefStillCurrent(pendingZoneConfirmation))) {
        // The dipping zone is gone but the guard question is still open — a guard that
        // outlives its zone is real for whatever is running now.
        cancelPendingConfirmation();
        if (currentGuard) {
          await onGuardActivated();
        }
      } else if (Date.now() >= pendingZoneConfirmation.confirmAfter) {
        const psi = heartbeat.sensors?.waterPsi;
        const baseline = heartbeat.device?.baselinePsi;
        const belowBaseline =
          typeof psi === "number" && typeof baseline === "number" && psi < baseline;
        if (hardwareGuard || belowBaseline || rainPause.active) {
          console.log(
            `[GuardDeferral] Confirmation heartbeat still shows low pressure (guard=${hardwareGuard}, psi=${psi ?? "n/a"}, baseline=${baseline ?? "n/a"}) — deferring zone ${pendingZoneConfirmation.zoneId}`
          );
          cancelPendingConfirmation();
          deferredThisHeartbeat = true;
          await deferActiveRun();
        } else {
          console.log(
            `[GuardDeferral] Confirmation heartbeat shows healthy pressure (psi=${psi ?? "n/a"}, baseline=${baseline ?? "n/a"}) — dip attributed to zone ${pendingZoneConfirmation.zoneId} startup, continuing`
          );
          // The zone passed its one confirmation — no further checks for its remainder.
          suppressedZoneActivation = {
            runId: pendingZoneConfirmation.runId,
            zoneIndex: pendingZoneConfirmation.zoneIndex,
            zoneId: pendingZoneConfirmation.zoneId
          };
          cancelPendingConfirmation();
        }
      } else if (currentGuard === false && previousGuard === true) {
        console.log("[GuardDeferral] Guard cleared before the confirmation check — zone dip resolved");
        cancelPendingConfirmation();
      }
    }

    if (currentGuard === true && previousGuard === false && !pendingZoneConfirmation) {
      // A rain pause is never zone-induced — it always defers. A hardware-only rise is
      // checked for attribution to the current zone's expected pressure dip first.
      const attributed = !rainPause.active && (await tryBeginZoneConfirmation());
      if (!attributed) {
        await onGuardActivated();
      }
    }

    if (currentGuard === false && previousGuard === true && !deferredThisHeartbeat) {
      if (pendingGraceDeferral) {
        console.log("[GuardDeferral] Guard cleared during grace period — no deferral needed");
        pendingGraceDeferral = null;
      }
      await onGuardDeactivated();
    }

    if (currentGuard === true) {
      if (suppressedZoneActivation && !(await zoneRefStillCurrent(suppressedZoneActivation))) {
        console.log(
          "[GuardDeferral] Confirmed zone is no longer running but guard is still active — treating as a real activation"
        );
        suppressedZoneActivation = null;
        await onGuardActivated();
      }

      if (pendingGraceDeferral) {
        const elapsed = Date.now() - pendingGraceDeferral.zoneStartedAt;
        if (elapsed >= GUARD_GRACE_PERIOD_MS) {
          const active = getActiveRun();
          if (active && active.runId === pendingGraceDeferral.runId) {
            console.log("[GuardDeferral] Grace period expired, guard still active — deferring now");
            pendingGraceDeferral = null;
            await deferActiveRun();
          } else {
            pendingGraceDeferral = null;
          }
        }
      }

      await checkDeadlines();
    }

    // When guard is off but deferred tasks exist, check if we've entered a preferred window
    if (currentGuard === false && !deferredThisHeartbeat && await hasDeferredTasks()) {
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
  lastHardwareGuard = null;
  deferredPrograms.clear();
  pendingGraceDeferral = null;
  cancelPendingConfirmation();
  suppressedZoneActivation = null;

  try {
    const latest = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
    if (latest) {
      const rainPause = await getRainPauseState(latest);
      lastGuardState = latest.guard || rainPause.active;
      lastHardwareGuard = latest.guard;
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
      const reason = "Deferral deadline expired during server restart";
      for (const zone of run.zones) {
        if (zone.status === "queued" || zone.status === "deferred" || zone.status === "activating" || zone.status === "running") {
          zone.status = "skipped";
          zone.completedAt = now;
          zone.error = reason;
        }
      }
      run.status = "failed";
      run.statusReason = reason;
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
  lastHardwareGuard = null;
  deferredPrograms.clear();
  pendingGraceDeferral = null;
  cancelPendingConfirmation();
  suppressedZoneActivation = null;
  console.log("[GuardDeferral] Monitor stopped");
};
