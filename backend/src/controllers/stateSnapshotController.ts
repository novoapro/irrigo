import { Request, Response } from "express";
import Heartbeat from "../models/Heartbeat";
import SystemConfig from "../models/SystemConfig";
import SequentialRun from "../models/SequentialRun";
import { getActiveRun } from "../services/sequentialRunService";
import { getAllZoneStates } from "../services/zoneService";
import { statusCache } from "./statusController";

export const getStateSnapshot = async (_req: Request, res: Response) => {
  try {
    const [latestHeartbeat, systemConfig, zoneStates, activeSequentialRun] = await Promise.all([
      Heartbeat.findOne().sort({ timestamp: -1 }).lean(),
      SystemConfig.findOne().lean(),
      getAllZoneStates(),
      (async () => {
        const activeRef = getActiveRun();
        if (activeRef) {
          return SequentialRun.findById(activeRef.runId).lean();
        }
        return SequentialRun.findOne({ status: { $in: ["running", "deferred"] } })
          .sort({ startedAt: -1 })
          .lean();
      })()
    ]);

    res.json({
      guard: latestHeartbeat?.guard ?? false,
      irrigationMode: systemConfig?.irrigationMode ?? "manual",
      zoneStates,
      activeRun: activeSequentialRun ?? null,
      status: statusCache.payload ?? null,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Failed to build state snapshot:", error);
    res.status(500).json({ message: "Unable to fetch state snapshot" });
  }
};
