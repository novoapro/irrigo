import { Request, Response } from "express";
import AIScheduleConfig from "../models/AIScheduleConfig";
import ScheduleRun from "../models/ScheduleRun";
import ScheduleEntry from "../models/ScheduleEntry";
import type { AIScheduleConfigInput } from "../schemas/aiScheduleConfigSchema";
import { runScheduleEvaluation } from "../services/aiSchedulingService";
import { emitRealtimeEvent } from "../services/realtimeService";

const maskApiKey = (key?: string | null): string | null => {
  if (!key) return null;
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
};

export const getAIScheduleConfig = async (_req: Request, res: Response) => {
  try {
    const config = await AIScheduleConfig.findOne().lean();
    if (!config) {
      return res.json({ data: null });
    }
    const { apiKey, ...rest } = config;
    res.json({ data: { ...rest, apiKey: maskApiKey(apiKey) } });
  } catch (err) {
    console.error("Failed to fetch AI schedule config:", err);
    res.status(500).json({ message: "Unable to fetch AI config" });
  }
};

export const upsertAIScheduleConfig = async (req: Request, res: Response) => {
  const payload = req.validatedBody as AIScheduleConfigInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid AI config payload" });
  }

  try {
    const update: Record<string, unknown> = {
      ...payload,
      updatedAt: new Date()
    };

    if (typeof payload.apiKey === "string" && payload.apiKey.includes("••••")) {
      delete update.apiKey;
    }

    const result = await AIScheduleConfig.findOneAndUpdate(
      {},
      { $set: update },
      { upsert: true, new: true }
    ).lean();

    const { apiKey, ...safe } = result;
    res.json({ data: { ...safe, apiKey: maskApiKey(apiKey) } });
  } catch (err) {
    console.error("Failed to upsert AI schedule config:", err);
    res.status(500).json({ message: "Unable to save AI config" });
  }
};

export const triggerScheduleRun = async (_req: Request, res: Response) => {
  try {
    const result = await runScheduleEvaluation("manual");
    res.json({ data: result });
  } catch (err: any) {
    console.error("Schedule run failed:", err);
    const message = err?.message ?? "Schedule run failed";
    const status = message.includes("not configured") || message.includes("disabled") || message.includes("not set")
      ? 400
      : 500;
    res.status(status).json({ message });
  }
};

export const listScheduleRuns = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(req.query.pageSize) || 20), 100);
    const skip = (page - 1) * pageSize;

    const [totalCount, runs] = await Promise.all([
      ScheduleRun.countDocuments(),
      ScheduleRun.find()
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
    ]);

    res.json({
      data: runs,
      meta: {
        page,
        pageSize,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize))
      }
    });
  } catch (err) {
    console.error("Failed to list schedule runs:", err);
    res.status(500).json({ message: "Unable to fetch schedule runs" });
  }
};

export const getScheduleRun = async (req: Request, res: Response) => {
  try {
    const run = await ScheduleRun.findOne({ scheduleRunId: req.params.runId }).lean();
    if (!run) {
      return res.status(404).json({ message: "Schedule run not found" });
    }
    const entries = await ScheduleEntry.find({ scheduleRunId: req.params.runId })
      .sort({ plannedStartAt: 1 })
      .lean();
    res.json({ data: { ...run, entries } });
  } catch (err) {
    console.error("Failed to get schedule run:", err);
    res.status(500).json({ message: "Unable to fetch schedule run" });
  }
};

export const listScheduleEntries = async (req: Request, res: Response) => {
  try {
    const filter: Record<string, unknown> = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.zoneId) filter.zoneId = req.query.zoneId;

    const entries = await ScheduleEntry.find(filter)
      .sort({ plannedStartAt: 1 })
      .limit(200)
      .lean();
    res.json({ data: entries });
  } catch (err) {
    console.error("Failed to list schedule entries:", err);
    res.status(500).json({ message: "Unable to fetch schedule entries" });
  }
};

export const getUpcomingEntries = async (_req: Request, res: Response) => {
  try {
    const entries = await ScheduleEntry.find({
      status: "planned",
      plannedStartAt: { $gte: new Date() }
    })
      .sort({ plannedStartAt: 1 })
      .limit(50)
      .lean();
    res.json({ data: entries });
  } catch (err) {
    console.error("Failed to fetch upcoming entries:", err);
    res.status(500).json({ message: "Unable to fetch upcoming entries" });
  }
};

export const cancelEntry = async (req: Request, res: Response) => {
  try {
    const entry = await ScheduleEntry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ message: "Entry not found" });
    }
    if (entry.status !== "planned") {
      return res.status(400).json({ message: `Cannot cancel entry with status '${entry.status}'` });
    }
    entry.status = "cancelled";
    entry.updatedAt = new Date();
    await entry.save();
    emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
    res.json({ data: entry });
  } catch (err) {
    console.error("Failed to cancel entry:", err);
    res.status(500).json({ message: "Unable to cancel entry" });
  }
};

export const skipEntry = async (req: Request, res: Response) => {
  try {
    const entry = await ScheduleEntry.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ message: "Entry not found" });
    }
    if (entry.status !== "planned") {
      return res.status(400).json({ message: `Cannot skip entry with status '${entry.status}'` });
    }
    entry.status = "skipped";
    entry.skipReason = (req.body as { reason?: string })?.reason ?? "Manually skipped";
    entry.updatedAt = new Date();
    await entry.save();
    emitRealtimeEvent({ type: "schedule:entryUpdated", payload: entry.toObject() });
    res.json({ data: entry });
  } catch (err) {
    console.error("Failed to skip entry:", err);
    res.status(500).json({ message: "Unable to skip entry" });
  }
};
