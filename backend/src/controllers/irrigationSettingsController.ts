import { Request, Response } from "express";
import IrrigationSettings from "../models/configs/IrrigationSettings";
import type { IrrigationSettingsInput } from "../schemas/irrigationSettingsSchema";
import { getIrrigationSettings } from "../services/irrigationSettingsService";

export const get = async (_req: Request, res: Response) => {
  try {
    const settings = await getIrrigationSettings();
    res.json({ data: settings });
  } catch (error) {
    console.error("Failed to get irrigation settings:", error);
    res.status(500).json({ message: "Unable to fetch irrigation settings" });
  }
};

export const update = async (req: Request, res: Response) => {
  const payload = req.validatedBody as IrrigationSettingsInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid settings payload" });
  }

  try {
    const doc = await IrrigationSettings.findOne();
    if (doc) {
      Object.assign(doc, payload, { updatedAt: new Date() });
      await doc.save();
      res.json({ data: doc.toObject() });
    } else {
      const created = await IrrigationSettings.create({ ...payload, updatedAt: new Date() });
      res.json({ data: created.toObject() });
    }
  } catch (error) {
    console.error("Failed to update irrigation settings:", error);
    res.status(500).json({ message: "Unable to update irrigation settings" });
  }
};
