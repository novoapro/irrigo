import { Request, Response } from "express";
import { runAllZones, cancelManualRun, getManualRunStatus } from "../services/manualRunService";

export const triggerManualRun = async (req: Request, res: Response) => {
  try {
    const zoneOverrides = Array.isArray(req.body?.zoneOverrides) ? req.body.zoneOverrides : undefined;
    const runId = await runAllZones(zoneOverrides);
    res.json({ data: { started: true, runId } });
  } catch (error: any) {
    console.error("Failed to trigger manual run:", error);
    res.status(400).json({ message: error?.message ?? "Unable to run" });
  }
};

export const handleCancelManualRun = async (_req: Request, res: Response) => {
  try {
    const cancelled = await cancelManualRun();
    if (!cancelled) {
      return res.status(404).json({ message: "No active manual run to cancel" });
    }
    res.json({ data: { cancelled: true } });
  } catch (error: any) {
    res.status(500).json({ message: error?.message ?? "Failed to cancel" });
  }
};

export const handleGetManualRunStatus = async (_req: Request, res: Response) => {
  try {
    const status = await getManualRunStatus();
    res.json({ data: status });
  } catch (error: any) {
    res.status(500).json({ message: error?.message ?? "Failed to get status" });
  }
};
