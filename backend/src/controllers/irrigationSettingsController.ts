import { Request, Response } from "express";
import IrrigationSettings from "../models/configs/IrrigationSettings";
import type { RainIntensity } from "../models/configs/IrrigationSettings";
import type { IrrigationSettingsInput } from "../schemas/irrigationSettingsSchema";
import { getIrrigationSettings } from "../services/irrigationSettingsService";
import { emitRealtimeEvent } from "../services/realtimeService";
import PrecipitationHistory from "../models/PrecipitationHistory";
import Heartbeat from "../models/Heartbeat";
import AIScheduleConfig from "../models/configs/AIScheduleConfig";

export const get = async (_req: Request, res: Response) => {
  try {
    const settings = await getIrrigationSettings();
    res.json({ data: settings });
  } catch (error) {
    console.error("Failed to get irrigation settings:", error);
    res.status(500).json({ message: "Unable to fetch irrigation settings" });
  }
};

export const update = async (req: Request, res: Response) => {
  const payload = req.validatedBody as IrrigationSettingsInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid settings payload" });
  }

  try {
    const doc = await IrrigationSettings.findOne();
    if (doc) {
      Object.assign(doc, payload, { updatedAt: new Date() });
      await doc.save();
      res.json({ data: doc.toObject() });
    } else {
      const created = await IrrigationSettings.create({ ...payload, updatedAt: new Date() });
      res.json({ data: created.toObject() });
    }
  } catch (error) {
    console.error("Failed to update irrigation settings:", error);
    res.status(500).json({ message: "Unable to update irrigation settings" });
  }
};

export const confirmRain = async (req: Request, res: Response) => {
  try {
    const intensity = (req.body as { intensity?: string })?.intensity;
    const validIntensities: RainIntensity[] = ["light", "moderate", "heavy"];
    if (!intensity || !validIntensities.includes(intensity as RainIntensity)) {
      return res.status(400).json({ message: "intensity is required: light, moderate, or heavy" });
    }

    const now = new Date();
    const doc = await IrrigationSettings.findOne();
    if (doc) {
      doc.lastConfirmedRainAt = now;
      doc.lastConfirmedRainIntensity = intensity as RainIntensity;
      doc.updatedAt = now;
      await doc.save();
    } else {
      await IrrigationSettings.create({
        lastConfirmedRainAt: now,
        lastConfirmedRainIntensity: intensity,
        updatedAt: now
      });
    }
    emitRealtimeEvent({ type: "rain:confirmed", payload: { confirmedAt: now.toISOString(), intensity } });
    res.json({ data: { confirmedAt: now.toISOString(), intensity } });
  } catch (error) {
    console.error("Failed to confirm rain:", error);
    res.status(500).json({ message: "Unable to confirm rain" });
  }
};

export const getRainAlert = async (_req: Request, res: Response) => {
  try {
    const settings = await getIrrigationSettings();
    const aiConfig = await AIScheduleConfig.findOne().lean();
    const rainPauseHours = settings.rainPauseHours ?? 48;
    const threshold = aiConfig?.preferences?.rainThresholdPercent ?? 40;

    if (rainPauseHours <= 0) {
      return res.json({ data: { alert: false } });
    }

    const now = new Date();
    const lookbackStart = new Date(now.getTime() - rainPauseHours * 3600_000);

    const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
    const connected = latestHeartbeat?.device?.connectedSensors ?? [];

    const lastSensorRain = connected.includes("RAIN")
      ? await Heartbeat.findOne({ "sensors.rain": true }).sort({ timestamp: -1 }).lean()
      : null;
    const lastSensorSoil = connected.includes("SOIL")
      ? await Heartbeat.findOne({ "sensors.soil": true }).sort({ timestamp: -1 }).lean()
      : null;
    const lastConfirmed = settings.lastConfirmedRainAt ? new Date(settings.lastConfirmedRainAt) : null;

    const lastKnownRainAt = [
      lastSensorRain ? new Date(lastSensorRain.timestamp) : null,
      lastSensorSoil ? new Date(lastSensorSoil.timestamp) : null,
      lastConfirmed
    ].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;

    const searchAfter = lastKnownRainAt && lastKnownRainAt > lookbackStart
      ? lastKnownRainAt
      : lookbackStart;

    const precipEvent = await PrecipitationHistory.findOne({
      periodStart: { $gt: searchAfter, $lt: now },
      probability: { $gte: threshold }
    }).sort({ periodStart: -1 }).lean();

    if (!precipEvent) {
      return res.json({ data: { alert: false } });
    }

    res.json({
      data: {
        alert: true,
        probability: precipEvent.probability,
        periodStart: precipEvent.periodStart.toISOString(),
        threshold
      }
    });
  } catch (error) {
    console.error("Failed to check rain alert:", error);
    res.status(500).json({ message: "Unable to check rain alert" });
  }
};
