import IrrigationProgram from "../models/IrrigationProgram";
import SystemConfig from "../models/SystemConfig";
import { createCommand } from "./irrigationCommandService";
import { emitRealtimeEvent } from "./realtimeService";

const CHECK_INTERVAL_MS = 30_000;
let checkTimer: NodeJS.Timeout | null = null;
const lastFiredMinute = new Map<string, number>();

const cronMatchesNow = (cron: string, now: Date): boolean => {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minPart, hourPart, domPart, , dowPart] = parts;
  const minute = now.getMinutes();
  const hour = now.getHours();
  const dayOfWeek = now.getDay();

  if (minPart !== "*" && parseInt(minPart!, 10) !== minute) return false;
  if (hourPart !== "*" && parseInt(hourPart!, 10) !== hour) return false;

  if (domPart && domPart !== "*") {
    const stepMatch = domPart.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      const dayOfMonth = now.getDate();
      if (dayOfMonth % parseInt(stepMatch[1]!, 10) !== 1) return false;
    }
  }

  if (dowPart && dowPart !== "*") {
    if (parseInt(dowPart, 10) !== dayOfWeek) return false;
  }

  return true;
};

const minuteKey = (now: Date): number =>
  now.getFullYear() * 1_000_000 + (now.getMonth() + 1) * 10_000 + now.getDate() * 100 + now.getHours() * 60 + now.getMinutes();

const executeProgramZones = async (programId: string, zoneEntries: { zoneId: string; durationMinutes: number }[]) => {
  for (const entry of zoneEntries) {
    try {
      await createCommand(entry.zoneId, "on", entry.durationMinutes, "schedule");
    } catch (err) {
      console.error(`[ProgramScheduler] Failed to run zone ${entry.zoneId} in program ${programId}:`, err);
    }
  }
};

const checkPrograms = async () => {
  const config = await SystemConfig.findOne().lean();
  if (!config || config.irrigationMode !== "scheduled") return;

  const now = new Date();
  const programs = await IrrigationProgram.find({ enabled: true }).lean();

  for (const program of programs) {
    if (!cronMatchesNow(program.scheduleCron, now)) continue;

    const mk = minuteKey(now);
    if (lastFiredMinute.get(program.programId) === mk) continue;
    lastFiredMinute.set(program.programId, mk);

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
  await executeProgramZones(program.programId, program.zoneEntries);

  return { programId: program.programId, zonesTriggered: program.zoneEntries.length };
};
