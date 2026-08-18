import { Request, Response } from "express";
import IrrigationSettings from "../models/configs/IrrigationSettings";
import type { RainIntensity } from "../models/configs/IrrigationSettings";
import type { IrrigationSettingsInput } from "../schemas/irrigationSettingsSchema";
import { getIrrigationSettings, getDayKeyInTimezone } from "../services/irrigationSettingsService";
import { getRainPauseState, cancelScheduledRunsWithinRainPause } from "../services/guardService";
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
      doc.lastRainPromptRespondedAt = now;
      doc.lastRainPromptResponse = "confirmed";
      doc.updatedAt = now;
      await doc.save();
    } else {
      await IrrigationSettings.create({
        lastConfirmedRainAt: now,
        lastConfirmedRainIntensity: intensity,
        lastRainPromptRespondedAt: now,
        lastRainPromptResponse: "confirmed",
        updatedAt: now
      });
    }
    emitRealtimeEvent({ type: "rain:confirmed", payload: { confirmedAt: now.toISOString(), intensity } });

    // Confirming rain arms the software guard. Cancel any runs already scheduled to start
    // within the resulting pause window (AI programs + runs materialized from configured
    // programs) so they don't fire when the guard clears mid-window.
    let cancelledRuns = 0;
    try {
      const rainPause = await getRainPauseState();
      cancelledRuns = await cancelScheduledRunsWithinRainPause(rainPause);
      if (cancelledRuns > 0) {
        console.log(`[ConfirmRain] Rain pause armed — cancelled ${cancelledRuns} scheduled run(s) within the window`);
      }
    } catch (cancelErr) {
      console.error("Failed to cancel scheduled runs after rain confirmation:", cancelErr);
    }

    res.json({ data: { confirmedAt: now.toISOString(), intensity, cancelledRuns } });
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

    // At most one prompt per calendar day (settings timezone): once the user has
    // answered — confirmed rain or dismissed — stay quiet until the next day.
    const respondedAt = settings.lastRainPromptRespondedAt
      ? new Date(settings.lastRainPromptRespondedAt)
      : null;
    if (respondedAt) {
      const tz = settings.timezone ?? "America/New_York";
      if (getDayKeyInTimezone(respondedAt, tz) === getDayKeyInTimezone(now, tz)) {
        return res.json({ data: { alert: false, respondedToday: true } });
      }
    }
    const lookbackStart = new Date(now.getTime() - rainPauseHours * 3600_000);

    const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
    const connected = latestHeartbeat?.device?.connectedSensors ?? [];

    const lastSensorRain = connected.includes("RAIN")
      ? await Heartbeat.findOne({ "sensors.rain": true }).sort({ timestamp: -1 }).lean()
      : null;
    const lastConfirmed = settings.lastConfirmedRainAt ? new Date(settings.lastConfirmedRainAt) : null;

    // Only sensor rain and user-confirmed rain count as "rain we already know about" —
    // soil saturation is not a rain signal and must not suppress the forecast alert.
    const lastKnownRainAt = [
      lastSensorRain ? new Date(lastSensorRain.timestamp) : null,
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

// User answered the rain prompt with "no, it didn't rain". Persist the response so the
// alert stays dismissed across reloads/re-mounts until the next calendar day.
export const dismissRainAlert = async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const doc = await IrrigationSettings.findOne();
    if (doc) {
      doc.lastRainPromptRespondedAt = now;
      doc.lastRainPromptResponse = "dismissed";
      doc.updatedAt = now;
      await doc.save();
    } else {
      await IrrigationSettings.create({
        lastRainPromptRespondedAt: now,
        lastRainPromptResponse: "dismissed",
        updatedAt: now
      });
    }

    emitRealtimeEvent({
      type: "rain:promptResponded",
      payload: { respondedAt: now.toISOString(), response: "dismissed" }
    });

    res.json({ data: { respondedAt: now.toISOString(), response: "dismissed" } });
  } catch (error) {
    console.error("Failed to dismiss rain alert:", error);
    res.status(500).json({ message: "Unable to dismiss rain alert" });
  }
};

// Removes the active rain pause regardless of its source (rain sensor or user-confirmed).
// User-confirmed fields are nulled, and a `rainPauseClearedAt` watermark is stamped so a
// still-standing sensor detection is ignored too — without deleting heartbeat data. A new
// rain event after the watermark re-arms the pause normally.
export const clearRainPause = async (_req: Request, res: Response) => {
  try {
    const rainPause = await getRainPauseState();
    if (!rainPause.active) {
      return res.status(409).json({ message: "No rain pause is active" });
    }

    const now = new Date();
    const doc = await IrrigationSettings.findOne();
    if (doc) {
      doc.lastConfirmedRainAt = null;
      doc.lastConfirmedRainIntensity = null;
      doc.rainPauseClearedAt = now;
      doc.updatedAt = now;
      await doc.save();
    } else {
      await IrrigationSettings.create({ rainPauseClearedAt: now, updatedAt: now });
    }

    const updated = await getRainPauseState();
    emitRealtimeEvent({ type: "rain:pauseCleared", payload: { rainPause: updated } });

    res.json({ data: { cleared: true, rainPause: updated } });
  } catch (error) {
    console.error("Failed to clear rain pause:", error);
    res.status(500).json({ message: "Unable to clear rain pause" });
  }
};
