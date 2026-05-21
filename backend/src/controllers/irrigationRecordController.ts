import type { Request, Response } from "express";
import IrrigationEvent from "../models/IrrigationEvent";
import IrrigationRecord from "../models/IrrigationRecord";
import { statusCache } from "./statusController";
import { emitRealtimeEvent } from "../services/realtimeService";

const MAX_PAGE_SIZE = 500;

export const latestPerZone = async (_req: Request, res: Response) => {
  try {
    const records = await IrrigationRecord.aggregate([
      { $sort: { startedAt: -1 } },
      {
        $group: {
          _id: "$zoneId",
          doc: { $first: "$$ROOT" }
        }
      },
      { $replaceRoot: { newRoot: "$doc" } }
    ]);
    res.json({ data: records });
  } catch (error) {
    console.error("Failed to fetch latest irrigation records per zone:", error);
    res.status(500).json({ message: "Unable to fetch latest records" });
  }
};

export const deleteIrrigationRecords = async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};

  const { start, end, zoneId, source } = req.query;

  if (typeof start === "string" && start.length > 0) {
    const parsed = new Date(start);
    if (Number.isNaN(parsed.valueOf())) {
      return res.status(400).json({ message: "start must be a valid date string" });
    }
    filter.startedAt = { ...((filter.startedAt as Record<string, Date>) ?? {}), $gte: parsed };
  }

  if (typeof end === "string" && end.length > 0) {
    const parsed = new Date(end);
    if (Number.isNaN(parsed.valueOf())) {
      return res.status(400).json({ message: "end must be a valid date string" });
    }
    filter.startedAt = { ...((filter.startedAt as Record<string, Date>) ?? {}), $lte: parsed };
  }

  if (typeof zoneId === "string" && zoneId.length > 0) {
    filter.zoneId = zoneId;
  }

  if (typeof source === "string" && ["manual", "program", "ai-schedule"].includes(source)) {
    filter.source = source;
  }

  const eventFilter: Record<string, unknown> = {};
  if (filter.startedAt) eventFilter.createdAt = filter.startedAt;
  if (filter.zoneId) eventFilter.zone = filter.zoneId;
  if (filter.source) eventFilter.source = filter.source;

  try {
    const [recordResult, eventResult] = await Promise.all([
      IrrigationRecord.deleteMany(filter),
      IrrigationEvent.deleteMany(eventFilter)
    ]);

    statusCache.payload = null;
    statusCache.irrigationId = null;

    emitRealtimeEvent({ type: "irrigation:updated" });
    emitRealtimeEvent({ type: "status:updated" });

    res.json({
      deletedCount: recordResult.deletedCount,
      deletedEvents: eventResult.deletedCount
    });
  } catch (error) {
    console.error("Failed to delete irrigation records:", error);
    res.status(500).json({ message: "Unable to delete irrigation records" });
  }
};

export const listIrrigationRecords = async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};

  const { start, end, zoneId, source } = req.query;

  if (typeof start === "string" && start.length > 0) {
    const parsed = new Date(start);
    if (Number.isNaN(parsed.valueOf())) {
      return res.status(400).json({ message: "start must be a valid date string" });
    }
    filter.startedAt = { ...((filter.startedAt as Record<string, Date>) ?? {}), $gte: parsed };
  }

  if (typeof end === "string" && end.length > 0) {
    const parsed = new Date(end);
    if (Number.isNaN(parsed.valueOf())) {
      return res.status(400).json({ message: "end must be a valid date string" });
    }
    filter.startedAt = { ...((filter.startedAt as Record<string, Date>) ?? {}), $lte: parsed };
  }

  if (typeof zoneId === "string" && zoneId.length > 0) {
    filter.zoneId = zoneId;
  }

  if (typeof source === "string" && ["manual", "program", "ai-schedule"].includes(source)) {
    filter.source = source;
  }

  const pageCandidate = Number.parseInt((req.query.page as string) ?? "", 10);
  const page = Number.isInteger(pageCandidate) && pageCandidate > 0 ? pageCandidate : 1;

  const pageSizeCandidate = Number.parseInt((req.query.pageSize as string) ?? "", 10);
  const pageSize =
    Number.isInteger(pageSizeCandidate) && pageSizeCandidate > 0
      ? Math.min(pageSizeCandidate, MAX_PAGE_SIZE)
      : 25;

  const skip = (page - 1) * pageSize;

  try {
    const [totalCount, records] = await Promise.all([
      IrrigationRecord.countDocuments(filter),
      IrrigationRecord.find(filter)
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    res.json({
      data: records,
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
    console.error("Failed to list irrigation records:", error);
    res.status(500).json({ message: "Unable to fetch irrigation records" });
  }
};
