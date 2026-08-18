import { Request, Response } from "express";
import Heartbeat from "../models/Heartbeat";
import SystemConfig from "../models/SystemConfig";
import SequentialRun from "../models/SequentialRun";
import { getActiveRun } from "../services/sequentialRunService";
import { getAllZoneStates } from "../services/zoneService";
import { getRainPauseState } from "../services/guardService";
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

    const rainPause = await getRainPauseState(latestHeartbeat);

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
