import { Request, Response } from "express";
import type { UpdateSystemConfigInput } from "../schemas/systemConfigSchema";
import * as systemConfigService from "../services/systemConfigService";

export const getConfig = async (_req: Request, res: Response) => {
  try {
    const config = await systemConfigService.getSystemConfig();
    res.json({ data: config });
  } catch (error) {
    console.error("Failed to get system config:", error);
    res.status(500).json({ message: "Unable to fetch system config" });
  }
};

export const updateConfig = async (req: Request, res: Response) => {
  const payload = req.validatedBody as UpdateSystemConfigInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid config payload" });
  }

  try {
    const config = await systemConfigService.updateSystemConfig(payload.irrigationMode);
    res.json({ data: config });
  } catch (error) {
    console.error("Failed to update system config:", error);
    res.status(500).json({ message: "Unable to update system config" });
  }
};
