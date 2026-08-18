import IrrigationProgram from "../models/IrrigationProgram";
import SystemConfig from "../models/SystemConfig";
import Zone from "../models/Zone";
import { startSequentialRun, cancelRun } from "./sequentialRunService";
import type { StartRunZoneInput } from "./sequentialRunService";
import { emitRealtimeEvent } from "./realtimeService";
import { addDeferredProgram } from "./guardDeferralService";
import { getEffectiveGuard } from "./guardService";
import { getTimezone } from "./irrigationSettingsService";
import { cronMatchesNow, getMinuteKeyInTimezone } from "./cronUtils";

const CHECK_INTERVAL_MS = 30_000;
let checkTimer: NodeJS.Timeout | null = null;
const lastFiredMinute = new Map<string, string>();

const buildZoneInputs = async (
  zoneEntries: { zoneId: string; durationMinutes: number }[]
): Promise<StartRunZoneInput[]> => {
  const zoneIds = zoneEntries.map((e) => e.zoneId);
  const zones = await Zone.find({ zoneId: { $in: zoneIds } }).lean();
  const nameMap = new Map(zones.map((z) => [z.zoneId, z.name]));

  return zoneEntries.map((e) => ({
    zoneId: e.zoneId,
    name: nameMap.get(e.zoneId) ?? e.zoneId,
    durationMinutes: e.durationMinutes
  }));
};

const executeProgramZones = async (
  programId: string,
  zoneEntries: { zoneId: string; durationMinutes: number }[]
) => {
  try {
    const { getWaterSavingFactor } = await import("./irrigationSettingsService");
    const factor = await getWaterSavingFactor();
    const adjustedEntries = factor < 1
      ? zoneEntries.map((e) => ({ ...e, durationMinutes: Math.max(1, Math.round(e.durationMinutes * factor)) }))
      : zoneEntries;
    const inputs = await buildZoneInputs(adjustedEntries);
    await startSequentialRun(inputs, "program", programId);
  } catch (err) {
    console.error(`[ProgramScheduler] Failed to start sequential run for program ${programId}:`, err);
  }
};

const checkPrograms = async () => {
  const config = await SystemConfig.findOne().lean();
  if (!config || config.irrigationMode !== "scheduled") return;

  const now = new Date();
  const tz = await getTimezone();
  const programs = await IrrigationProgram.find({
    enabled: true,
    source: { $in: ["manual", null] },
    scheduleCron: { $ne: null }
  }).lean();

  for (const program of programs) {
    if (!program.scheduleCron) continue;
    if (!cronMatchesNow(program.scheduleCron, now, tz)) continue;

    const mk = getMinuteKeyInTimezone(now, tz);
    if (lastFiredMinute.get(program.programId) === mk) continue;
    lastFiredMinute.set(program.programId, mk);

    const guard = await getEffectiveGuard();

    // Rain pause is a known, multi-hour condition with a definite expiry — skip this
    // occurrence outright rather than deferring it (deferral is meant for transient
    // hardware-guard blips that clear on their own).
    if (guard.rainPause.active) {
      const reason = guard.reason ?? "Rain pause active — irrigation paused";
      console.log(`[ProgramScheduler] ${reason} — skipping program "${program.name}"`);
      emitRealtimeEvent({
        type: "program:skipped",
        payload: { programId: program.programId, name: program.name, reason }
      });
      continue;
    }

    if (guard.hardware) {
      const deadline = new Date(now.getTime() + 24 * 60 * 60_000);
      addDeferredProgram({
        programId: program.programId,
        deferredAt: now,
        deadline,
        zoneEntries: program.zoneEntries
      });
      console.log(`[ProgramScheduler] Guard active — deferred program "${program.name}" until ${deadline.toISOString()}`);
      emitRealtimeEvent({
        type: "deferral:triggered",
        payload: {
          type: "deferred-program",
          programId: program.programId,
          reason: "Guard active — conditions not suitable for irrigation",
          deadline: deadline.toISOString()
        }
      });
      continue;
    }

    console.log(`[ProgramScheduler] Triggering program "${program.name}" (${program.programId})`);
    emitRealtimeEvent({ type: "program:triggered", payload: { programId: program.programId, name: program.name } });

    void executeProgramZones(program.programId, program.zoneEntries);
  }
};

export const startProgramScheduler = () => {
  if (checkTimer) return;
  checkTimer = setInterval(() => {
    void checkPrograms();
  }, CHECK_INTERVAL_MS);
  console.log("[ProgramScheduler] Started, checking every 30s");
};

export const stopProgramScheduler = () => {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
    lastFiredMinute.clear();
    console.log("[ProgramScheduler] Stopped");
  }
};

export const runProgramNow = async (programId: string) => {
  const program = await IrrigationProgram.findOne({ programId }).lean();
  if (!program) throw new Error("Program not found");
  if (program.zoneEntries.length === 0) throw new Error("Program has no zone entries");

  emitRealtimeEvent({ type: "program:triggered", payload: { programId: program.programId, name: program.name } });

  const { getWaterSavingFactor } = await import("./irrigationSettingsService");
  const factor = await getWaterSavingFactor();
  const adjustedEntries = factor < 1
    ? program.zoneEntries.map((e) => ({ ...e, durationMinutes: Math.max(1, Math.round(e.durationMinutes * factor)) }))
    : program.zoneEntries;
  const inputs = await buildZoneInputs(adjustedEntries);
  const runId = await startSequentialRun(inputs, "program", program.programId);

  return { programId: program.programId, zonesTriggered: program.zoneEntries.length, runId };
};

export const cancelProgramRun = cancelRun;
