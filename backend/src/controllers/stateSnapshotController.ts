import { Request, Response } from "express";
import Heartbeat from "../models/Heartbeat";
import SystemConfig from "../models/SystemConfig";
import SequentialRun from "../models/SequentialRun";
import { getActiveRun } from "../services/sequentialRunService";
import { getAllZoneStates } from "../services/zoneService";
import { getIrrigationSettings } from "../services/irrigationSettingsService";
import { statusCache } from "./statusController";

export const getStateSnapshot = async (_req: Request, res: Response) => {
  try {
    const [latestHeartbeat, systemConfig, zoneStates, irrigationSettings, activeSequentialRun] = await Promise.all([
      Heartbeat.findOne().sort({ timestamp: -1 }).lean(),
      SystemConfig.findOne().lean(),
      getAllZoneStates(),
      getIrrigationSettings(),
      (async () => {
        const activeRef = getActiveRun();
        if (activeRef) {
          return SequentialRun.findById(activeRef.runId).lean();
        }
        const orphaned = await SequentialRun.findOne({ status: { $in: ["running", "deferred"] } })
          .sort({ startedAt: -1 });
        if (orphaned) {
          for (const zone of orphaned.zones) {
            if (zone.status === "queued" || zone.status === "deferred" || zone.status === "activating" || zone.status === "running") {
              zone.status = "skipped";
              zone.completedAt = new Date();
              zone.error = "Run orphaned — no active execution context";
            }
          }
          orphaned.status = "failed";
          orphaned.statusReason = "Run orphaned — no active execution context";
          orphaned.completedAt = new Date();
          await orphaned.save();
          return null;
        }
        return null;
      })()
    ]);

    const now = new Date();
    const rainPauseHours = irrigationSettings.rainPauseHours ?? 48;
    const connected = latestHeartbeat?.device?.connectedSensors ?? [];

    let rainPause: { active: boolean; source?: string; triggeredAt?: string; expiresAt?: string; remainingHours?: number } = { active: false };

    if (rainPauseHours > 0) {
      const INTENSITY_MULTIPLIERS: Record<string, number> = { light: 0.25, moderate: 0.5, heavy: 1.0 };

      const lastSensorRain = connected.includes("RAIN")
        ? await Heartbeat.findOne({ "sensors.rain": true }).sort({ timestamp: -1 }).lean()
        : null;
      const lastSensorSoil = connected.includes("SOIL")
        ? await Heartbeat.findOne({ "sensors.soil": true }).sort({ timestamp: -1 }).lean()
        : null;
      const confirmedAt = irrigationSettings.lastConfirmedRainAt ? new Date(irrigationSettings.lastConfirmedRainAt) : null;
      const confirmedIntensity = (irrigationSettings.lastConfirmedRainIntensity as string) ?? "heavy";
      const confirmedMultiplier = INTENSITY_MULTIPLIERS[confirmedIntensity] ?? 1.0;

      const sensorMs = rainPauseHours * 3600_000;
      const confirmedMs = rainPauseHours * 3600_000 * confirmedMultiplier;

      const candidates: { at: Date; source: string; effectiveMs: number }[] = [];
      if (lastSensorRain) candidates.push({ at: new Date(lastSensorRain.timestamp), source: "rain sensor", effectiveMs: sensorMs });
      if (lastSensorSoil) candidates.push({ at: new Date(lastSensorSoil.timestamp), source: "soil sensor", effectiveMs: sensorMs });
      if (confirmedAt) candidates.push({ at: confirmedAt, source: `user (${confirmedIntensity})`, effectiveMs: confirmedMs });

      for (const c of candidates) {
        const expires = new Date(c.at.getTime() + c.effectiveMs);
        if (expires > now) {
          const remaining = (expires.getTime() - now.getTime()) / 3600_000;
          if (!rainPause.active || expires.getTime() > new Date(rainPause.expiresAt!).getTime()) {
            rainPause = {
              active: true,
              source: c.source,
              triggeredAt: c.at.toISOString(),
              expiresAt: expires.toISOString(),
              remainingHours: Math.round(remaining * 10) / 10
            };
          }
        }
      }
    }

    res.json({
      guard: latestHeartbeat?.guard ?? false,
      irrigationMode: systemConfig?.irrigationMode ?? "manual",
      zoneStates,
      activeRun: activeSequentialRun ?? null,
      rainPause,
      status: statusCache.payload ?? null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Failed to build state snapshot:", error);
    res.status(500).json({ message: "Unable to fetch state snapshot" });
  }
};
