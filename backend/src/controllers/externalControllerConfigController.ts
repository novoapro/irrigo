import { Request, Response } from "express";
import ExternalControllerConfig from "../models/ExternalControllerConfig";
import type { ExternalControllerConfigInput } from "../schemas/externalControllerConfigSchema";
import { emitRealtimeEvent } from "../services/realtimeService";
import { invalidateCache, testConnection } from "../services/externalControllerService";

const maskToken = (token?: string | null): string | null => {
  if (!token) return null;
  if (token.length <= 8) return "••••••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}`;
};

export const getExternalControllerConfig = async (_req: Request, res: Response) => {
  try {
    const config = await ExternalControllerConfig.findOne().sort({ updatedAt: -1 }).lean();
    if (!config) {
      return res.status(404).json({ message: "No external controller configured" });
    }
    const { authToken, ...rest } = config;
    res.json({ data: { ...rest, authToken: maskToken(authToken) } });
  } catch (err) {
    console.error("Failed to fetch external controller config:", err);
    res.status(500).json({ message: "Unable to fetch config" });
  }
};

export const upsertExternalControllerConfig = async (req: Request, res: Response) => {
  const payload = req.validatedBody as ExternalControllerConfigInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid config payload" });
  }

  try {
    const update: Record<string, unknown> = {
      ...payload,
      updatedAt: new Date()
    };

    if (payload.authToken?.includes("••••")) {
      delete update.authToken;
    }

    const result = await ExternalControllerConfig.findOneAndUpdate(
      {},
      { $set: update },
      { upsert: true, new: true }
    ).lean();

    invalidateCache();

    const { authToken, ...safe } = result;
    const responseData = { ...safe, authToken: maskToken(authToken) };

    emitRealtimeEvent({ type: "deviceConfig:updated", payload: responseData });
    res.json({ data: responseData });
  } catch (err) {
    console.error("Failed to upsert external controller config:", err);
    res.status(500).json({ message: "Unable to save config" });
  }
};

export const testExternalControllerConnection = async (_req: Request, res: Response) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (err) {
    console.error("Failed to test connection:", err);
    res.status(500).json({ success: false, message: "Test failed" });
  }
};
