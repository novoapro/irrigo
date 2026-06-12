import { Request, Response } from "express";
import type { CreateProgramInput, UpdateProgramInput } from "../schemas/irrigationProgramSchema";
import IrrigationProgram from "../models/IrrigationProgram";
import SequentialRun from "../models/SequentialRun";
import * as programService from "../services/programService";
import { runProgramNow, cancelProgramRun } from "../services/programSchedulerService";
import { clearActiveRun, getActiveRun } from "../services/sequentialRunService";
import { emitRealtimeEvent } from "../services/realtimeService";

export const listPrograms = async (req: Request, res: Response) => {
  try {
    const source = req.query.source as string | undefined;
    const status = req.query.status as string | string[] | undefined;
    const programs = await programService.listPrograms({ source, status });
    res.json({ data: programs });
  } catch (error) {
    console.error("Failed to list programs:", error);
    res.status(500).json({ message: "Unable to fetch programs" });
  }
};

export const getProgram = async (req: Request, res: Response) => {
  try {
    const program = await programService.getProgram(req.params.programId);
    if (!program) {
      return res.status(404).json({ message: "Program not found" });
    }
    res.json({ data: program });
  } catch (error) {
    console.error("Failed to get program:", error);
    res.status(500).json({ message: "Unable to fetch program" });
  }
};

export const createProgram = async (req: Request, res: Response) => {
  const payload = req.validatedBody as CreateProgramInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid program payload" });
  }

  try {
    const program = await programService.createProgram(payload);
    res.status(201).json({ data: program });
  } catch (error) {
    console.error("Failed to create program:", error);
    res.status(500).json({ message: "Unable to create program" });
  }
};

export const updateProgram = async (req: Request, res: Response) => {
  const payload = req.validatedBody as UpdateProgramInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid program payload" });
  }

  try {
    const program = await programService.updateProgram(req.params.programId, payload);
    if (!program) {
      return res.status(404).json({ message: "Program not found" });
    }
    res.json({ data: program });
  } catch (error) {
    console.error("Failed to update program:", error);
    res.status(500).json({ message: "Unable to update program" });
  }
};

export const deleteProgram = async (req: Request, res: Response) => {
  try {
    const deleted = await programService.deleteProgram(req.params.programId);
    if (!deleted) {
      return res.status(404).json({ message: "Program not found" });
    }
    res.json({ message: "Program deleted" });
  } catch (error) {
    console.error("Failed to delete program:", error);
    res.status(500).json({ message: "Unable to delete program" });
  }
};

export const runProgram = async (req: Request, res: Response) => {
  try {
    const result = await runProgramNow(req.params.programId);
    res.json({ data: result });
  } catch (error: any) {
    console.error("Failed to run program:", error);
    res.status(400).json({ message: error?.message ?? "Unable to run program" });
  }
};

export const handleCancelProgramRun = async (_req: Request, res: Response) => {
  try {
    const cancelled = await cancelProgramRun();
    if (!cancelled) {
      return res.status(404).json({ message: "No active program run to cancel" });
    }
    res.json({ data: { cancelled: true } });
  } catch (error: any) {
    res.status(500).json({ message: error?.message ?? "Failed to cancel program run" });
  }
};

export const cancelAIProgram = async (req: Request, res: Response) => {
  try {
    const program = await IrrigationProgram.findOne({
      programId: req.params.programId,
      source: "ai-schedule",
      status: { $in: ["planned", "deferred", "executing"] }
    });
    if (!program) {
      return res.status(404).json({ message: "AI program not found or not cancellable" });
    }

    const previousStatus = program.status;

    program.status = "cancelled";
    program.statusReason = "Manually cancelled by user";
    program.updatedAt = new Date();
    await program.save();

    if (previousStatus === "executing") {
      await cancelProgramRun();
    }

    if (previousStatus === "deferred" || previousStatus === "executing") {
      const activeRunInfo = getActiveRun();
      const run = activeRunInfo?.programId === program.programId
        ? await SequentialRun.findById(activeRunInfo.runId)
        : await SequentialRun.findOne({
            programId: program.programId,
            status: { $in: ["running", "deferred"] }
          });

      if (run && run.status !== "cancelled" && run.status !== "completed" && run.status !== "failed") {
        for (const zone of run.zones) {
          if (zone.status === "queued" || zone.status === "deferred" || zone.status === "activating") {
            zone.status = "skipped";
            zone.completedAt = new Date();
            zone.error = "Program cancelled";
          }
        }
        run.status = "cancelled";
        run.statusReason = "Manually cancelled by user";
        run.completedAt = new Date();
        await run.save();

        if (activeRunInfo?.programId === program.programId) {
          clearActiveRun();
        }

        const runObj = run.toObject() as Record<string, unknown>;
        emitRealtimeEvent({
          type: "sequentialRun:cancelled",
          payload: { ...runObj, source: run.source }
        });
      }
    }

    res.json({ data: program.toObject() });
  } catch (error) {
    console.error("Failed to cancel AI program:", error);
    res.status(500).json({ message: "Unable to cancel AI program" });
  }
};

export const skipAIProgram = async (req: Request, res: Response) => {
  try {
    const reason = (req.body as { reason?: string })?.reason ?? "Manually skipped by user";
    const result = await IrrigationProgram.findOneAndUpdate(
      { programId: req.params.programId, source: "ai-schedule", status: { $in: ["planned", "deferred"] } },
      { $set: { status: "skipped", statusReason: reason, updatedAt: new Date() } },
      { new: true }
    ).lean();
    if (!result) {
      return res.status(404).json({ message: "AI program not found or not skippable" });
    }
    res.json({ data: result });
  } catch (error) {
    console.error("Failed to skip AI program:", error);
    res.status(500).json({ message: "Unable to skip AI program" });
  }
};

export const deferAIProgram = async (req: Request, res: Response) => {
  try {
    const { plannedStartAt } = req.body as { plannedStartAt: string };
    if (!plannedStartAt) {
      return res.status(400).json({ message: "plannedStartAt is required" });
    }
    const result = await IrrigationProgram.findOneAndUpdate(
      { programId: req.params.programId, source: "ai-schedule", status: { $in: ["planned", "deferred"] } },
      { $set: { plannedStartAt: new Date(plannedStartAt), updatedAt: new Date() } },
      { new: true }
    ).lean();
    if (!result) {
      return res.status(404).json({ message: "AI program not found or not deferrable" });
    }
    res.json({ data: result });
  } catch (error) {
    console.error("Failed to defer AI program:", error);
    res.status(500).json({ message: "Unable to defer AI program" });
  }
};

export const listSequentialRuns = async (req: Request, res: Response) => {
  try {
    const pageCandidate = Number.parseInt((req.query.page as string) ?? "", 10);
    const page = Number.isInteger(pageCandidate) && pageCandidate > 0 ? pageCandidate : 1;
    const pageSizeCandidate = Number.parseInt((req.query.pageSize as string) ?? "", 10);
    const pageSize = Number.isInteger(pageSizeCandidate) && pageSizeCandidate > 0
      ? Math.min(pageSizeCandidate, 100)
      : 25;

    const filter: Record<string, unknown> = {};
    const source = req.query.source as string | undefined;
    if (source && source !== "all") filter.source = source;
    const status = req.query.status as string | undefined;
    if (status && status !== "all") filter.status = status;

    const skip = (page - 1) * pageSize;
    const [totalCount, runs] = await Promise.all([
      SequentialRun.countDocuments(filter),
      SequentialRun.find(filter)
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    res.json({
      data: runs,
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
    console.error("Failed to list sequential runs:", error);
    res.status(500).json({ message: "Unable to fetch sequential runs" });
  }
};
