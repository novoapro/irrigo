import { Request, Response } from "express";
import CompAIConfig from "../models/CompAIConfig";
import WebhookEvent from "../models/WebhookEvent";
import Zone from "../models/Zone";
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

    const payload = parsed.data;
    const result = await processWebhookPayload(payload);

    const zone = await Zone.findOne({ "compAI.serviceId": payload.serviceId })
      .select({ zoneId: 1, name: 1 })
      .lean();

    WebhookEvent.create({
      deviceId: payload.deviceId,
      serviceId: payload.serviceId,
      serviceName: payload.serviceName ?? null,
      characteristicId: payload.characteristicId,
      characteristicType: payload.characteristicType,
      characteristicName: payload.characteristicName ?? null,
      oldValue: payload.oldValue,
      newValue: payload.newValue,
      zoneId: zone?.zoneId ?? null,
      zoneName: zone?.name ?? null,
      processed: result.processed,
      result: result.action ?? result.reason ?? null,
      receivedAt: new Date()
    }).catch((err) => console.error("Failed to persist webhook event:", err));

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

export const listWebhookEvents = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(Number(req.query.pageSize) || 50, 500);
    const skip = (page - 1) * pageSize;

    const filter: Record<string, unknown> = {};
    if (req.query.zoneId) filter.zoneId = req.query.zoneId;
    if (req.query.characteristicType) filter.characteristicType = req.query.characteristicType;
    if (req.query.start || req.query.end) {
      const dateFilter: Record<string, Date> = {};
      if (req.query.start) dateFilter.$gte = new Date(req.query.start as string);
      if (req.query.end) dateFilter.$lte = new Date(req.query.end as string);
      filter.receivedAt = dateFilter;
    }

    const [totalCount, events] = await Promise.all([
      WebhookEvent.countDocuments(filter),
      WebhookEvent.find(filter)
        .sort({ receivedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    res.json({
      events,
      meta: {
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    console.error("Failed to list webhook events:", error);
    res.status(500).json({ message: "Failed to fetch webhook events" });
  }
};

export const deleteWebhookEvents = async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.zoneId) filter.zoneId = req.query.zoneId;
    if (req.query.characteristicType) filter.characteristicType = req.query.characteristicType;
    if (req.query.start || req.query.end) {
      const dateFilter: Record<string, Date> = {};
      if (req.query.start) dateFilter.$gte = new Date(req.query.start as string);
      if (req.query.end) dateFilter.$lte = new Date(req.query.end as string);
      filter.receivedAt = dateFilter;
    }

    const result = await WebhookEvent.deleteMany(filter);
    res.json({ deletedCount: result.deletedCount ?? 0 });
  } catch (error) {
    console.error("Failed to delete webhook events:", error);
    res.status(500).json({ message: "Failed to delete webhook events" });
  }
};
