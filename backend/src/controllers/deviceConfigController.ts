import { Request, Response } from "express";
import DeviceConfig from "../models/DeviceConfig";
import type { DeviceConfigInput } from "../schemas/deviceConfigSchema";
import { emitRealtimeEvent } from "../services/realtimeService";

export const getDeviceConfig = async (req: Request, res: Response) => {
  const ip = (req.params.ip as string | undefined) || (req.query.ip as string | undefined);
  try {
    const filter = ip ? { deviceIp: ip } : {};

    const config = await DeviceConfig.findOne(filter).sort({ updatedAt: -1 }).lean();
    if (!config) {
      return res.status(204).json({ message: "There is not config for this device" });;
    }
    if (config.forceHeartbeat) {
      await DeviceConfig.updateOne(
        { deviceIp: config.deviceIp },
        { $set: { forceHeartbeat: false } }
      );
      emitRealtimeEvent({
        type: "forceHeartbeat:acknowledged",
        payload: { deviceIp: config.deviceIp }
      });
    }
    return res.json({ data: config });
  } catch (error) {
    console.error("Failed to fetch device config:", error);
    return res.status(500).json({ message: "Unable to fetch config" });
  }
};

export const upsertDeviceConfig = async (req: Request, res: Response) => {
  const payload = req.validatedBody as DeviceConfigInput | undefined;
  if (!payload) {
    console.warn("[API] upsertDeviceConfig - invalid payload", {
      method: req.method,
      url: req.originalUrl,
      params: req.params,
      body: JSON.stringify(req.body)
    });
    return res.status(400).json({ message: "Invalid config payload" });
  }

  const ip = req.params.ip || req.query.ip;
  try {
    const deviceIp = ip ? ip : payload.deviceIp;
    const update = {
      ...payload,
      deviceIp: deviceIp,
      updatedAt: new Date()
    };

    if (deviceIp) {
      await DeviceConfig.deleteMany({ deviceIp: { $ne: deviceIp } });
    }

    const result = await DeviceConfig.findOneAndUpdate(
      { deviceIp: deviceIp },
      { $set: update },
      { upsert: true, new: true }
    ).lean();

    if (update.forceHeartbeat) {
      emitRealtimeEvent({
        type: "forceHeartbeat:queued",
        payload: { deviceIp }
      });
    } else {
      emitRealtimeEvent({
        type: "deviceConfig:updated",
        payload: result
      });
    }

    return res.json({ data: result });
  } catch (error) {
    console.error("Failed to upsert device config:", error);
    return res.status(500).json({ message: "Unable to save config" });
  }
};
