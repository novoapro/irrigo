import { Request, Response } from "express";
import type { CreateZoneInput, UpdateZoneInput, ReorderZonesInput } from "../schemas/zoneSchema";
import { emitRealtimeEvent } from "../services/realtimeService";
import * as zoneService from "../services/zoneService";

export const listZones = async (_req: Request, res: Response) => {
  try {
    const zones = await zoneService.listZones();
    res.json({ data: zones });
  } catch (error) {
    console.error("Failed to list zones:", error);
    res.status(500).json({ message: "Unable to fetch zones" });
  }
};

export const getZone = async (req: Request, res: Response) => {
  try {
    const zone = await zoneService.getZone(req.params.zoneId);
    if (!zone) {
      return res.status(404).json({ message: "Zone not found" });
    }
    res.json({ data: zone });
  } catch (error) {
    console.error("Failed to get zone:", error);
    res.status(500).json({ message: "Unable to fetch zone" });
  }
};

export const createZone = async (req: Request, res: Response) => {
  const payload = req.validatedBody as CreateZoneInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid zone payload" });
  }

  try {
    const zone = await zoneService.createZone(payload);
    emitRealtimeEvent({ type: "zone:created", payload: zone });
    res.status(201).json({ data: zone });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "A zone with this zoneId already exists" });
    }
    console.error("Failed to create zone:", error);
    res.status(500).json({ message: "Unable to create zone" });
  }
};

export const updateZone = async (req: Request, res: Response) => {
  const payload = req.validatedBody as UpdateZoneInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid zone payload" });
  }

  try {
    const zone = await zoneService.updateZone(req.params.zoneId, payload);
    if (!zone) {
      return res.status(404).json({ message: "Zone not found" });
    }
    emitRealtimeEvent({ type: "zone:updated", payload: zone });
    res.json({ data: zone });
  } catch (error) {
    console.error("Failed to update zone:", error);
    res.status(500).json({ message: "Unable to update zone" });
  }
};

export const deleteZone = async (req: Request, res: Response) => {
  try {
    const deleted = await zoneService.deleteZone(req.params.zoneId);
    if (!deleted) {
      return res.status(404).json({ message: "Zone not found" });
    }
    emitRealtimeEvent({ type: "zone:deleted", payload: { zoneId: req.params.zoneId } });
    res.json({ message: "Zone deleted" });
  } catch (error) {
    console.error("Failed to delete zone:", error);
    res.status(500).json({ message: "Unable to delete zone" });
  }
};

export const toggleZone = async (req: Request, res: Response) => {
  try {
    const zone = await zoneService.toggleZone(req.params.zoneId);
    if (!zone) {
      return res.status(404).json({ message: "Zone not found" });
    }
    emitRealtimeEvent({ type: "zone:updated", payload: zone });
    res.json({ data: zone });
  } catch (error) {
    console.error("Failed to toggle zone:", error);
    res.status(500).json({ message: "Unable to toggle zone" });
  }
};

export const reorderZones = async (req: Request, res: Response) => {
  const payload = req.validatedBody as ReorderZonesInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid reorder payload" });
  }

  try {
    const zones = await zoneService.reorderZones(payload.order);
    res.json({ data: zones });
  } catch (error) {
    console.error("Failed to reorder zones:", error);
    res.status(500).json({ message: "Unable to reorder zones" });
  }
};

export const getZoneState = async (req: Request, res: Response) => {
  try {
    const state = await zoneService.getZoneState(req.params.zoneId);
    res.json({ data: state });
  } catch (error) {
    console.error("Failed to get zone state:", error);
    res.status(500).json({ message: "Unable to fetch zone state" });
  }
};

export const getAllZoneStates = async (_req: Request, res: Response) => {
  try {
    const states = await zoneService.getAllZoneStates();
    res.json({ data: states });
  } catch (error) {
    console.error("Failed to get zone states:", error);
    res.status(500).json({ message: "Unable to fetch zone states" });
  }
};
