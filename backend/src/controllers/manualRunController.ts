import { Request, Response } from "express";
import { runAllZones } from "../services/manualRunService";

export const triggerManualRun = async (_req: Request, res: Response) => {
  try {
    const results = await runAllZones();
    res.json({ data: results });
  } catch (error: any) {
    console.error("Failed to trigger manual run:", error);
    res.status(400).json({ message: error?.message ?? "Unable to run" });
  }
};
