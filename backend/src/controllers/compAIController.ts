import { Request, Response } from "express";
import CompAIConfig from "../models/CompAIConfig";
import {
  processWebhookPayload,
  invalidateConfigCache,
  testConnection,
  fetchDeviceInfo,
  resolveCharacteristics
} from "../services/compAIService";
import { compAIWebhookPayloadSchema } from "../schemas/compAISchema";

const MASK = "••••••••";

const maskSecret = (secret: string | null | undefined): string | null => {
  if (!secret) return null;
  if (secret.length <= 8) return MASK;
  return secret.slice(0, 4) + MASK + secret.slice(-4);
};

export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const parsed = compAIWebhookPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(200).json({ processed: false, reason: "invalid_payload" });
    }

    const result = await processWebhookPayload(parsed.data);
    res.status(200).json(result);
  } catch (error) {
    console.error("CompAI webhook processing error:", error);
    res.status(200).json({ processed: false, reason: "internal_error" });
  }
};

export const getCompAIConfig = async (_req: Request, res: Response) => {
  try {
    const config = await CompAIConfig.findOne().lean();
    if (!config) {
      return res.json({ data: null });
    }
    res.json({
      data: {
        _id: config._id,
        enabled: config.enabled,
        deviceId: config.deviceId,
        endpoint: config.endpoint ?? null,
        authType: config.authType,
        authToken: maskSecret(config.authToken),
        timeoutMs: config.timeoutMs,
        webhookSecret: maskSecret(config.webhookSecret),
        lastWebhookAt: config.lastWebhookAt ?? null,
        updatedAt: config.updatedAt
      }
    });
  } catch (error) {
    console.error("Failed to get CompAI config:", error);
    res.status(500).json({ message: "Failed to fetch config" });
  }
};

export const upsertCompAIConfig = async (req: Request, res: Response) => {
  try {
    const { enabled, deviceId, endpoint, authType, authToken, timeoutMs, webhookSecret } = req.body;

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (enabled !== undefined) update.enabled = enabled;
    if (deviceId !== undefined) update.deviceId = deviceId;
    if (endpoint !== undefined) update.endpoint = endpoint;
    if (authType !== undefined) update.authType = authType;
    if (authToken !== undefined && !authToken?.includes("••••")) {
      update.authToken = authToken;
    }
    if (timeoutMs !== undefined) update.timeoutMs = timeoutMs;
    if (webhookSecret !== undefined && !webhookSecret?.includes("••••")) {
      update.webhookSecret = webhookSecret;
    }

    const config = await CompAIConfig.findOneAndUpdate(
      {},
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    invalidateConfigCache();

    res.json({
      data: {
        _id: config._id,
        enabled: config.enabled,
        deviceId: config.deviceId,
        endpoint: config.endpoint ?? null,
        authType: config.authType,
        authToken: maskSecret(config.authToken),
        timeoutMs: config.timeoutMs,
        webhookSecret: maskSecret(config.webhookSecret),
        lastWebhookAt: config.lastWebhookAt ?? null,
        updatedAt: config.updatedAt
      }
    });
  } catch (error) {
    console.error("Failed to upsert CompAI config:", error);
    res.status(500).json({ message: "Failed to save config" });
  }
};

export const testCompAIConnection = async (_req: Request, res: Response) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (error) {
    console.error("CompAI connection test failed:", error);
    res.json({ success: false, message: "Test failed" });
  }
};

export const discoverServices = async (_req: Request, res: Response) => {
  try {
    const device = await fetchDeviceInfo();
    const services = device.services.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      characteristics: resolveCharacteristics(s)
    }));
    res.json({
      data: {
        deviceId: device.id,
        deviceName: device.name,
        isReachable: device.isReachable,
        services
      }
    });
  } catch (error: any) {
    console.error("CompAI discovery failed:", error);
    res.status(502).json({ message: error?.message ?? "Discovery failed" });
  }
};
