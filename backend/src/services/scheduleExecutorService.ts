import IrrigationProgram from "../models/IrrigationProgram";
import type { IrrigationProgramAttributes, ProgramZoneEntry } from "../models/IrrigationProgram";
import Heartbeat from "../models/Heartbeat";
import WeatherForecastSnapshot from "../models/WeatherForecastSnapshot";
import AIScheduleConfig from "../models/AIScheduleConfig";
import SystemConfig from "../models/SystemConfig";
import Zone from "../models/Zone";
import { startSequentialRun, isRunActive } from "./sequentialRunService";
import type { StartRunZoneInput } from "./sequentialRunService";
import type { SequentialRunSource } from "../models/SequentialRun";
import { emitRealtimeEvent } from "./realtimeService";
import { getEffectiveGuard } from "./guardService";
import { getDeferralDeadline, getWaterSavingFactor } from "./irrigationSettingsService";
import { getMinutesRunToday, getLastRunByZone } from "./irrigationHistoryService";

// The single, source-agnostic program executor. Every planned IrrigationProgram — AI or
// manual — is run through the one `runProgram` pre-flight pipeline here. The AI planner
// (aiSchedulingService) and the manual materializer (programSchedulerService) only decide
// *when* a program becomes `planned` with a `plannedStartAt`; from that point on there is
// no source-specific execution path.

const LOOKAHEAD_MS = 60_000;
const CHECK_INTERVAL_MS = 30_000;
let checkTimer: NodeJS.Timeout | null = null;

// Hydrated program doc — anything with the fields the pipeline reads/writes and .save().
type ProgramDoc = IrrigationProgramAttributes & {
  save: () => Promise<unknown>;
  toObject: () => Record<string, unknown>;
};

export const buildZoneInputs = async (
  zoneEntries: { zoneId: string; durationMinutes: number }[]
): Promise<StartRunZoneInput[]> => {
  const zoneIds = zoneEntries.map((e) => e.zoneId);
  const zones = await Zone.find({ zoneId: { $in: zoneIds } }).lean();
  const nameMap = new Map(zones.map((z) => [z.zoneId, z.name]));
  const maxMap = new Map(zones.map((z) => [z.zoneId, z.maxDurationMinutes ?? 60]));
  const known = new Set(zones.map((z) => z.zoneId));

  const inputs: StartRunZoneInput[] = [];
  for (const e of zoneEntries) {
    // Skip a zone the AI invented (e.g. "lateral" instead of "laterals"). Letting an
    // unknown zoneId through makes createCommand throw "Zone not found" and fails the run;
    // dropping it lets the remaining valid zones still water.
    if (!known.has(e.zoneId)) {
      console.warn(`[ScheduleExecutor] Skipping unknown zone "${e.zoneId}" — not in zone config (bad AI zoneId).`);
      continue;
    }
    // AI-generated durations are not constrained by the program zod schema the way
    // user-entered programs are, so clamp them to a sane [1, zoneMax] range here.
    // An out-of-range value (0/negative/NaN → "few instants"; over-max → createCommand
    // throws and the zone fails) would otherwise make the run diverge from the plan.
    const max = maxMap.get(e.zoneId) ?? 60;
    const raw = Math.round(Number(e.durationMinutes));
    const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), max) : 1;
    if (clamped !== e.durationMinutes) {
      console.warn(
        `[ScheduleExecutor] Clamped zone ${e.zoneId} duration ${e.durationMinutes} → ${clamped}m (max ${max}m)`
      );
    }
    inputs.push({
      zoneId: e.zoneId,
      name: nameMap.get(e.zoneId) ?? e.zoneId,
      durationMinutes: clamped
    });
  }
  return inputs;
};

const runSourceFor = (program: { source?: string }): SequentialRunSource =>
  program.source === "ai-schedule" ? "ai-schedule" : "program";

const skipProgram = async (program: ProgramDoc, reason: string) => {
  program.status = "skipped";
  program.statusReason = reason;
  program.deferredAt = undefined;
  program.deferralDeadline = undefined;
  program.updatedAt = new Date();
  await program.save();
  console.warn(`[ScheduleExecutor] Skipped program "${program.name}" (${program.programId}) — ${reason}`);
  emitRealtimeEvent({ type: "program:skipped", payload: { programId: program.programId, name: program.name, reason } });
};

const deferProgram = async (program: ProgramDoc, reason: string, deadline: Date) => {
  program.status = "deferred";
  program.statusReason = reason;
  program.deferredAt = new Date();
  program.deferralDeadline = deadline;
  program.updatedAt = new Date();
  await program.save();
  emitRealtimeEvent({
    type: "deferral:triggered",
    payload: {
      type: program.source === "ai-schedule" ? "ai-program" : "deferred-program",
      programId: program.programId,
      reason,
      deadline: deadline.toISOString()
    }
  });
};

// The one pre-flight pipeline every planned program passes through, in order:
// guard/rain-pause → hardware-guard deferral → deferral-deadline expiry → rain & weather
// gate → daily/rest caps → execute (water-saving + zone clamp). Identical for AI and manual.
export const runProgram = async (program: ProgramDoc) => {
  if (!program || program.status !== "planned") return;

  const now = new Date();
  const plannedStart = program.plannedStartAt ?? now;
  const deadline = await getDeferralDeadline(plannedStart);

  const guard = await getEffectiveGuard();

  // Rain pause is a known, multi-hour condition — skip this occurrence outright rather than
  // holding it. (For a non-recurring AI program this is terminal; a recurring manual program
  // simply re-arms on its next cron.)
  if (guard.rainPause.active) {
    return skipProgram(program, guard.reason ?? "Rain pause active — irrigation paused");
  }

  // Hardware guard is transient — defer until the deferral deadline so the run can still
  // happen if conditions recover in time. Past the deadline there is no point holding it.
  if (guard.hardware) {
    if (now >= deadline) {
      return skipProgram(program, "Deferral window elapsed — guard did not clear in time");
    }
    return deferProgram(program, "Guard active — conditions not suitable for irrigation", deadline);
  }

  // The deferral deadline (plannedStartAt + maxDeferralHours) has passed with the program
  // still not run — skip it. This replaces the old "preferred window closed" expiry: the
  // window is now purely an AI-creation concern and no longer gates execution.
  if (now > deadline) {
    return skipProgram(program, "Deferral window elapsed — program not run in time");
  }

  // Rain & weather gate — now applied to every program, not just AI ones. Config still
  // physically lives in AIScheduleConfig.preferences (see plan: storage unchanged).
  const aiConfig = await AIScheduleConfig.findOne().lean();
  const prefs = aiConfig?.preferences;
  if (prefs?.conservativeWatering) {
    const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
    if (latestHeartbeat?.sensors?.rain?.triggered) {
      return skipProgram(program, "Rain detected — rain sensor active");
    }

    const forecast = await WeatherForecastSnapshot.findOne().sort({ fetchedAt: -1 }).lean();
    const precipProb = forecast?.precipitationProbability ?? 0;
    if (precipProb >= prefs.rainThresholdPercent) {
      return skipProgram(
        program,
        `Precipitation probability ${precipProb}% exceeds threshold (${prefs.rainThresholdPercent}%)`
      );
    }
  }

  // ── Effective durations: water saving is applied HERE for all sources. (The AI prompt no
  // longer pre-reduces durations, so there is no double counting — see aiSchedulingService.) ──
  const factor = await getWaterSavingFactor();
  let entries: ProgramZoneEntry[] = factor < 1
    ? program.zoneEntries.map((e) => ({ ...e, durationMinutes: Math.max(1, Math.round(e.durationMinutes * factor)) }))
    : program.zoneEntries.map((e) => ({ ...e }));

  // ── Min rest between runs: drop any zone that ran within the configured interval. ──
  const minDaysBetweenRuns = prefs?.minDaysBetweenRuns ?? 0;
  if (minDaysBetweenRuns > 0 && entries.length > 0) {
    const lastRunByZone = await getLastRunByZone(entries.map((e) => e.zoneId));
    const restMs = minDaysBetweenRuns * 24 * 3600_000;
    const kept: ProgramZoneEntry[] = [];
    for (const e of entries) {
      const last = lastRunByZone.get(e.zoneId);
      if (last && now.getTime() - last.getTime() < restMs) {
        console.log(`[ScheduleExecutor] Zone ${e.zoneId} ran within ${minDaysBetweenRuns}d — dropping (min rest not elapsed)`);
        continue;
      }
      kept.push(e);
    }
    if (kept.length === 0) {
      return skipProgram(program, `Min rest not elapsed — all zones ran within ${minDaysBetweenRuns} day(s)`);
    }
    entries = kept;
  }

  // ── Max total per day: skip if running this program would exceed the daily minute cap. ──
  const maxDailyRunMinutes = prefs?.maxDailyRunMinutes;
  if (typeof maxDailyRunMinutes === "number" && maxDailyRunMinutes > 0) {
    const minutesToday = await getMinutesRunToday(now);
    const programMinutes = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
    if (minutesToday + programMinutes > maxDailyRunMinutes) {
      return skipProgram(
        program,
        `Daily limit reached — ${minutesToday}m already run today + ${programMinutes}m would exceed ${maxDailyRunMinutes}m`
      );
    }
  }

  const inputs = await buildZoneInputs(entries);
  if (inputs.length === 0) {
    return skipProgram(program, "No runnable zones after validation");
  }

  program.status = "executing";
  program.updatedAt = new Date();
  await program.save();
  emitRealtimeEvent({ type: "program:triggered", payload: { programId: program.programId, name: program.name } });

  try {
    await startSequentialRun(inputs, runSourceFor(program), program.programId);
  } catch (err: any) {
    const reason = `Execution failed — ${err?.message ?? "unknown error"}`;
    program.status = "skipped";
    program.statusReason = reason;
    program.updatedAt = new Date();
    await program.save();
    console.error(`[ScheduleExecutor] Failed to start program ${program.programId}:`, err);
  }
};

const checkDuePrograms = async () => {
  const sysConfig = await SystemConfig.findOne().lean();
  // No automatic execution in manual mode. Both smart and scheduled run the same executor.
  if (!sysConfig || sysConfig.irrigationMode === "manual") return;

  if (isRunActive()) return;

  const now = new Date();
  const cutoff = new Date(now.getTime() + LOOKAHEAD_MS);

  // Every source is eligible — the old `source: "ai-schedule"` filter is gone.
  const duePrograms = await IrrigationProgram.find({
    status: "planned",
    enabled: true,
    plannedStartAt: { $ne: null, $lte: cutoff }
  }).sort({ plannedStartAt: 1 });

  for (const program of duePrograms) {
    if (isRunActive()) break;
    await runProgram(program as unknown as ProgramDoc);
  }
};

export const startScheduleExecutor = () => {
  if (checkTimer) return;
  checkTimer = setInterval(() => {
    void checkDuePrograms();
  }, CHECK_INTERVAL_MS);
  console.log("[ScheduleExecutor] Started, checking every 30s");
};

export const stopScheduleExecutor = () => {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
};
