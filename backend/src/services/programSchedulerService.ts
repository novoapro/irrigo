import IrrigationProgram from "../models/IrrigationProgram";
import SystemConfig from "../models/SystemConfig";
import { startSequentialRun, cancelRun } from "./sequentialRunService";
import type { StartRunZoneInput } from "./sequentialRunService";
import { emitRealtimeEvent } from "./realtimeService";
import { getTimezone, getWaterSavingFactor } from "./irrigationSettingsService";
import { buildZoneInputs } from "./scheduleExecutorService";
import { cronMatchesNow, getMinuteKeyInTimezone } from "./cronUtils";

// Materializer for manual (cron) programs. This service no longer executes anything — it
// only *arms* the next occurrence of each recurring program by giving it a plannedStartAt
// and status "planned". The single executor (scheduleExecutorService) then runs it through
// the same pre-flight pipeline as an AI program. This is what makes "a program is the same
// after creation, regardless of source" true.

const CHECK_INTERVAL_MS = 30_000;
let checkTimer: NodeJS.Timeout | null = null;
const lastFiredMinute = new Map<string, string>();

// A program that is already planned / running / waiting must not be re-armed on the same
// cron tick — only idle/terminal programs (completed, skipped, cancelled, or never run) are
// eligible to be armed for their next occurrence.
const ARMABLE = (status: string) => !["planned", "executing", "deferred"].includes(status);

const checkPrograms = async () => {
  const config = await SystemConfig.findOne().lean();
  // Manual programs are materialized in both "scheduled" and "smart" mode; only fully
  // manual mode disables automatic scheduling.
  if (!config || config.irrigationMode === "manual") return;

  const now = new Date();
  const tz = await getTimezone();
  const programs = await IrrigationProgram.find({
    enabled: true,
    source: { $in: ["manual", null] },
    scheduleCron: { $ne: null }
  });

  for (const program of programs) {
    if (!program.scheduleCron) continue;
    if (!cronMatchesNow(program.scheduleCron, now, tz)) continue;

    const mk = getMinuteKeyInTimezone(now, tz);
    if (lastFiredMinute.get(program.programId) === mk) continue;
    lastFiredMinute.set(program.programId, mk);

    if (!ARMABLE(program.status)) continue;

    // Arm the occurrence — the executor picks it up on its next tick and applies guard /
    // rain / weather / caps / deferral uniformly. No guard or execution logic lives here.
    program.plannedStartAt = now;
    program.status = "planned";
    program.statusReason = undefined;
    program.deferredAt = undefined;
    program.deferralDeadline = undefined;
    program.updatedAt = now;
    await program.save();

    console.log(`[ProgramScheduler] Armed manual program "${program.name}" (${program.programId})`);
    emitRealtimeEvent({ type: "program:updated", payload: program.toObject() });
  }
};

export const startProgramScheduler = () => {
  if (checkTimer) return;
  checkTimer = setInterval(() => {
    void checkPrograms();
  }, CHECK_INTERVAL_MS);
  console.log("[ProgramScheduler] Started (materializer), checking every 30s");
};

export const stopProgramScheduler = () => {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
    lastFiredMinute.clear();
    console.log("[ProgramScheduler] Stopped");
  }
};

// Explicit "Run now" — a user override, intentionally distinct from scheduled execution:
// it bypasses guard/rain/caps (the UI already prompts the user to confirm running while a
// guard is active). It still uses the shared buildZoneInputs (zone clamp + unknown-zone
// drop) and the water-saving factor so the *mechanics* of a run match the executor.
export const runProgramNow = async (programId: string) => {
  const program = await IrrigationProgram.findOne({ programId }).lean();
  if (!program) throw new Error("Program not found");
  if (program.zoneEntries.length === 0) throw new Error("Program has no zone entries");

  emitRealtimeEvent({ type: "program:triggered", payload: { programId: program.programId, name: program.name } });

  const factor = await getWaterSavingFactor();
  const adjustedEntries = factor < 1
    ? program.zoneEntries.map((e) => ({ ...e, durationMinutes: Math.max(1, Math.round(e.durationMinutes * factor)) }))
    : program.zoneEntries;

  const inputs: StartRunZoneInput[] = await buildZoneInputs(adjustedEntries);
  if (inputs.length === 0) throw new Error("Program has no runnable zones");

  const runId = await startSequentialRun(inputs, "program", program.programId);

  return { programId: program.programId, zonesTriggered: inputs.length, runId };
};

export const cancelProgramRun = cancelRun;
