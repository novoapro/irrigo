import Heartbeat from "../models/Heartbeat";
import IrrigationProgram from "../models/IrrigationProgram";
import ScheduleEntry from "../models/ScheduleEntry";
import { getIrrigationSettings } from "./irrigationSettingsService";
import { emitRealtimeEvent } from "./realtimeService";

export interface RainPauseState {
  active: boolean;
  /** Human label for the winning source, e.g. "rain sensor" or "user (heavy)". */
  source?: string;
  /** The rain event anchoring the active window. Present only when active. */
  triggeredAt?: string;
  /** When the active window ends. Present only when active. */
  expiresAt?: string;
  /** Hours until expiry. Present only when active. */
  remainingHours?: number;
  /** Effective window length in hours from the anchor to expiry. Present only when active. */
  windowHours?: number;
  /**
   * Most recent rain input on record (sensor or user-confirmed), after the cleared
   * watermark — reported even when its window has already expired, as context for
   * consumers (e.g. the AI prompt). Absent when no rain is on record post-watermark.
   */
  lastRainEventAt?: string;
}

export interface EffectiveGuardState {
  /** True when irrigation must not run — hardware guard OR rain pause. */
  active: boolean;
  /** Hardware guard reported by the latest heartbeat. */
  hardware: boolean;
  /** Software guard derived from rain (sensor/soil/user-confirmed). */
  rainPause: RainPauseState;
  /** Human-readable reason for the active guard, or null when clear. */
  reason: string | null;
}

const INTENSITY_MULTIPLIERS: Record<string, number> = { light: 0.25, moderate: 0.5, heavy: 1.0 };

type HeartbeatLike = {
  guard?: { triggered: boolean } | null;
  device?: { connectedSensors?: string[] | null } | null;
} | null;

/**
 * Computes the current rain-pause window. A rain pause is the "software" form of the
 * guard: it activates when rain/soil sensors or a user-confirmed rain report are recent
 * enough that the configured rainPauseHours window has not yet elapsed. When multiple
 * sources are active, the one with the latest expiry wins.
 */
export const getRainPauseState = async (latestHeartbeat?: HeartbeatLike): Promise<RainPauseState> => {
  const settings = await getIrrigationSettings();
  const rainPauseHours = settings.rainPauseHours ?? 48;
  if (rainPauseHours <= 0) return { active: false };

  const latest =
    latestHeartbeat !== undefined
      ? latestHeartbeat
      : await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
  const connected = latest?.device?.connectedSensors ?? [];

  const now = new Date();

  // A user-cleared pause sets this watermark: any rain event at or before it is ignored,
  // so a manual "remove pause" clears a still-standing sensor detection too (without
  // deleting heartbeat data). A newer rain event (after the watermark) re-arms normally.
  const clearedAt = settings.rainPauseClearedAt ? new Date(settings.rainPauseClearedAt) : null;

  // Rain pause has exactly two inputs: the rain sensor and the user's manual report.
  // Soil moisture is deliberately NOT a rain signal here — wet soil is a normal
  // post-irrigation condition and must not arm or hold a rain pause.
  // Most recent heartbeat where the rain sensor is (still) triggered. We anchor the pause
  // to `sensors.rain.since` — the moment rain *began*, not this latest still-raining
  // report — so a rain event that started before the user's clear watermark can't re-arm
  // the pause just because the sensor is still wet (we filter on `since`, not `timestamp`).
  const lastSensorRain = connected.includes("RAIN")
    ? await Heartbeat.findOne({
        "sensors.rain.triggered": true,
        ...(clearedAt ? { "sensors.rain.since": { $gt: clearedAt } } : {})
      }).sort({ timestamp: -1 }).lean()
    : null;
  const confirmedAt =
    settings.lastConfirmedRainAt && (!clearedAt || new Date(settings.lastConfirmedRainAt) > clearedAt)
      ? new Date(settings.lastConfirmedRainAt)
      : null;
  const confirmedIntensity = (settings.lastConfirmedRainIntensity as string) ?? "heavy";
  const confirmedMultiplier = INTENSITY_MULTIPLIERS[confirmedIntensity] ?? 1.0;

  // A sensor-detected rain is always treated as a heavy rain (full window), anchored to
  // when the sensor reported it. The pause then persists for the whole window even after
  // the sensor stops reporting rain — the same as a user-confirmed heavy rain.
  const sensorMs = rainPauseHours * 3600_000;
  const confirmedMs = rainPauseHours * 3600_000 * confirmedMultiplier;

  const sensorAt = lastSensorRain ? new Date(lastSensorRain.sensors.rain.since) : null;
  const sensorExpiresMs = sensorAt ? sensorAt.getTime() + sensorMs : null;
  const confirmedExpiresMs = confirmedAt ? confirmedAt.getTime() + confirmedMs : null;

  // Most recent rain input on record (post-watermark), regardless of whether its window
  // is still open. Surfaced as context even when the pause itself is inactive.
  const lastRainEventAt = [sensorAt, confirmedAt]
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const lastRainEventIso = lastRainEventAt ? lastRainEventAt.toISOString() : undefined;

  const sensorActive = sensorExpiresMs !== null && sensorExpiresMs > now.getTime();
  const confirmedActive = confirmedExpiresMs !== null && confirmedExpiresMs > now.getTime();

  if (!sensorActive && !confirmedActive) {
    return { active: false, lastRainEventAt: lastRainEventIso };
  }

  // The rain sensor is authoritative: whenever it has an active rain event it labels the
  // pause and anchors triggeredAt (the user's report is ignored for labelling). The pause
  // itself never ends earlier than either input would — the later expiry always wins.
  const source = sensorActive ? "rain sensor" : `user (${confirmedIntensity})`;
  const triggeredAt = sensorActive ? sensorAt! : confirmedAt!;
  const expiresMs = Math.max(
    sensorActive ? sensorExpiresMs! : 0,
    confirmedActive ? confirmedExpiresMs! : 0
  );

  return {
    active: true,
    source,
    triggeredAt: triggeredAt.toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    remainingHours: Math.round(((expiresMs - now.getTime()) / 3600_000) * 10) / 10,
    windowHours: Math.round(((expiresMs - triggeredAt.getTime()) / 3600_000) * 10) / 10,
    lastRainEventAt: lastRainEventIso
  };
};

/**
 * The effective guard combines the hardware guard (heartbeat) and the software guard
 * (rain pause). If either is active, irrigation must not run. This is the single source
 * of truth every execution path should consult before starting a run.
 */
export const getEffectiveGuard = async (): Promise<EffectiveGuardState> => {
  const latest = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
  const hardware = latest?.guard?.triggered ?? false;
  const rainPause = await getRainPauseState(latest);

  const reason = hardware
    ? "Guard active — conditions not suitable for irrigation"
    : rainPause.active
      ? `Rain pause active (${rainPause.source})${rainPause.expiresAt ? ` until ${rainPause.expiresAt}` : ""}`
      : null;

  return {
    active: hardware || rainPause.active,
    hardware,
    rainPause,
    reason
  };
};

/**
 * Cancels every run already scheduled to start within an active rain-pause window.
 * Covers AI programs (IrrigationProgram, source "ai-schedule") and runs materialized
 * from configured programs (ScheduleEntry). Recurring manual cron programs have no
 * materialized future instance and are instead blocked live by the effective guard.
 *
 * Returns the number of records cancelled. Safe to call when no pause is active (no-op).
 */
export const cancelScheduledRunsWithinRainPause = async (rainPause?: RainPauseState): Promise<number> => {
  const pause = rainPause ?? (await getRainPauseState());
  if (!pause.active || !pause.expiresAt) return 0;

  const now = new Date();
  const expires = new Date(pause.expiresAt);
  const reason = `Rain pause active (${pause.source}) until ${pause.expiresAt}`;

  let cancelled = 0;

  // AI programs whose planned start falls inside the pause window.
  const aiPrograms = await IrrigationProgram.find({
    source: "ai-schedule",
    status: { $in: ["planned", "deferred"] },
    plannedStartAt: { $gte: now, $lte: expires }
  });
  for (const program of aiPrograms) {
    program.status = "cancelled";
    program.statusReason = reason;
    program.deferredAt = undefined;
    program.deferralDeadline = undefined;
    program.updatedAt = now;
    await program.save();
    cancelled++;
    emitRealtimeEvent({ type: "program:updated", payload: program.toObject() });
  }

  // Materialized runs from configured programs (and AI runs) waiting to start.
  const entries = await ScheduleEntry.find({
    status: { $in: ["planned", "queued", "deferred"] },
    plannedStartAt: { $gte: now, $lte: expires }
  });
  for (const entry of entries) {
    entry.status = "cancelled";
    entry.skipReason = reason;
    entry.updatedAt = now;
    await entry.save();
    cancelled++;
    emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
  }

  return cancelled;
};
