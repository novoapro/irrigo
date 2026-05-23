import { Request, Response } from "express";
import DebugConfig from "../models/configs/DebugConfig";
import { invalidateDebugCache } from "../services/debugMockService";
import { persistEvent } from "../services/irrigationEventService";
import { emitRealtimeEvent } from "../services/realtimeService";
import Zone from "../models/Zone";

export const getDebugConfig = async (_req: Request, res: Response) => {
  try {
    const config = await DebugConfig.findOne().lean();
    res.json({ data: config ?? null });
  } catch (error) {
    console.error("Failed to get debug config:", error);
    res.status(500).json({ message: "Failed to fetch debug config" });
  }
};

export const upsertDebugConfig = async (req: Request, res: Response) => {
  try {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (req.body.enabled !== undefined) update.enabled = req.body.enabled;

    const config = await DebugConfig.findOneAndUpdate(
      {},
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    invalidateDebugCache();
    emitRealtimeEvent({ type: "debugMode:changed" as any, payload: { enabled: config.enabled } });

    res.json({ data: config });
  } catch (error) {
    console.error("Failed to upsert debug config:", error);
    res.status(500).json({ message: "Failed to save debug config" });
  }
};

export const simulateWebhook = async (req: Request, res: Response) => {
  try {
    const { zoneId, action } = req.body;

    const zone = await Zone.findOne({ zoneId }).lean();
    if (!zone) {
      return res.status(404).json({ message: "Zone not found" });
    }

    await persistEvent(zoneId, action);

    res.json({
      data: {
        processed: true,
        zoneId,
        zoneName: zone.name,
        action
      }
    });
  } catch (error) {
    console.error("Debug webhook simulation failed:", error);
    res.status(500).json({ message: "Webhook simulation failed" });
  }
};

export const getZonesForDebug = async (_req: Request, res: Response) => {
  try {
    const zones = await Zone.find({ enabled: true })
      .sort({ sortOrder: 1 })
      .select("zoneId name")
      .lean();

    res.json({ data: zones.map((z) => ({ zoneId: z.zoneId, name: z.name })) });
  } catch (error) {
    console.error("Failed to get debug zones:", error);
    res.status(500).json({ message: "Failed to fetch zones" });
  }
};
