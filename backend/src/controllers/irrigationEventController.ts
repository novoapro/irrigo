import { Request, Response } from "express";
import IrrigationEvent from "../models/IrrigationEvent";
import type { IrrigationEventInput } from "../schemas/irrigationEventSchema";
import { emitRealtimeEvent } from "../services/realtimeService";
import { refreshStatusCache } from "./statusController";
import Heartbeat from "../models/Heartbeat";

const MAX_LIST_LIMIT = 500;

const serializeEvent = (event: { _id?: unknown; zone: string; action: "on" | "off"; createdAt?: Date; waterPressure?: number | null }) => ({
  _id: (event as { _id?: unknown })._id ?? undefined,
  zone: event.zone,
  action: event.action,
  waterPressure: event.waterPressure ?? null,
  createdAt: event.createdAt ?? undefined
});

const persistEvent = async (zone: string, action: "on" | "off") => {
  const now = new Date();
  const trimmedZone = zone.trim();

  const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
  const pressure = latestHeartbeat?.sensors?.waterPsi ?? null;

  const event = await IrrigationEvent.create({
    zone: trimmedZone,
    action,
    waterPressure: pressure,
    createdAt: now
  });

  let refreshedStatus = null;
  try {
    refreshedStatus = await refreshStatusCache();
  } catch (error) {
    console.error("Failed to refresh status after irrigation event:", error);
  }

  emitRealtimeEvent({
    type: "irrigation:updated",
    payload: serializeEvent(event)
  });

  if (refreshedStatus) {
    emitRealtimeEvent({
      type: "status:updated",
      payload: refreshedStatus
    });
  }

  return event;
};

export const createIrrigationEvent = async (req: Request, res: Response) => {
  const payload = req.validatedBody as IrrigationEventInput | undefined;

  if (!payload) {
    console.warn("[API] createIrrigationEvent - invalid/missing payload", {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip
    });
    return res.status(500).json({
      message: "Irrigation payload was not validated. Is validateSchema middleware configured?"
    });
  }

  try {
    const event = await persistEvent(payload.zone, payload.state);
    res.status(200).json({
      message: `Irrigation ${payload.state} processed`,
      ...serializeEvent(event)
    });
  } catch (error) {
    console.error("Failed to store irrigation event:", error);
    res.status(500).json({ message: "Unable to store irrigation event" });
  }
};

export const createIrrigationEventFromPath = async (req: Request, res: Response) => {
  const zoneParam = (req.params.zone ?? "").trim();
  const stateParam = (req.params.state ?? "").toLowerCase();
  if (!zoneParam) {
    return res.status(400).json({ message: "zone is required" });
  }
  if (stateParam !== "on" && stateParam !== "off") {
    return res.status(400).json({ message: "state must be 'on' or 'off'" });
  }

  try {
    const event = await persistEvent(zoneParam, stateParam as "on" | "off");
    res.status(200).json({
      message: `Irrigation ${stateParam} processed`,
      ...serializeEvent(event)
    });
  } catch (error) {
    console.error("Failed to store irrigation event (path):", error);
    res.status(500).json({ message: "Unable to store irrigation event" });
  }
};

export const listIrrigationEvents = async (req: Request, res: Response) => {
  const { start, end } = req.query;

  const filter: Record<string, unknown> = {};
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (typeof start === "string" && start.length > 0) {
    const parsed = new Date(start);
    if (Number.isNaN(parsed.valueOf())) {
      console.warn("[API] listIrrigationEvents - invalid 'start' query", {
        method: req.method,
        url: req.originalUrl,
        start
      });
      return res.status(400).json({ message: "start must be a valid date string" });
    }
    startDate = parsed;
  }

  if (typeof end === "string" && end.length > 0) {
    const parsed = new Date(end);
    if (Number.isNaN(parsed.valueOf())) {
      console.warn("[API] listIrrigationEvents - invalid 'end' query", {
        method: req.method,
        url: req.originalUrl,
        end
      });
      return res.status(400).json({ message: "end must be a valid date string" });
    }
    endDate = parsed;
  }

  if (startDate && endDate && startDate > endDate) {
    console.warn("[API] listIrrigationEvents - 'start' is after 'end'", {
      method: req.method,
      url: req.originalUrl,
      start: startDate,
      end: endDate
    });
    return res.status(400).json({ message: "start must be before end" });
  }

  if (startDate || endDate) {
    const rangeFilter: Record<string, Date> = {};
    if (startDate) {
      rangeFilter.$gte = startDate;
    }
    if (endDate) {
      rangeFilter.$lte = endDate;
    }
    filter.createdAt = rangeFilter;
  }

  const pageCandidate = Number.parseInt((req.query.page as string) ?? "", 10);
  const page = Number.isInteger(pageCandidate) && pageCandidate > 0 ? pageCandidate : 1;

  const pageSizeCandidate = Number.parseInt((req.query.pageSize as string) ?? "", 10);
  const pageSize =
    Number.isInteger(pageSizeCandidate) && pageSizeCandidate > 0
      ? Math.min(pageSizeCandidate, MAX_LIST_LIMIT)
      : 50;

  const skip = (page - 1) * pageSize;

  try {
    const [totalCount, events] = await Promise.all([
      IrrigationEvent.countDocuments(filter),
      IrrigationEvent.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .select({ zone: 1, action: 1, createdAt: 1, waterPressure: 1 })
        .lean()
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    res.json({
      events: events.map((event) => serializeEvent(event as any)),
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
    console.error("Failed to list irrigation events:", error);
    res.status(500).json({ message: "Unable to fetch irrigation events" });
  }
};
