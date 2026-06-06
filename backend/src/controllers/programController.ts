import { Request, Response } from "express";
import type { CreateProgramInput, UpdateProgramInput } from "../schemas/irrigationProgramSchema";
import IrrigationProgram from "../models/IrrigationProgram";
import * as programService from "../services/programService";
import { runProgramNow, cancelProgramRun } from "../services/programSchedulerService";

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
    const result = await IrrigationProgram.findOneAndUpdate(
      { programId: req.params.programId, source: "ai-schedule", status: { $in: ["planned", "deferred"] } },
      { $set: { status: "cancelled", updatedAt: new Date() } },
      { new: true }
    ).lean();
    if (!result) {
      return res.status(404).json({ message: "AI program not found or not cancellable" });
    }
    res.json({ data: result });
  } catch (error) {
    console.error("Failed to cancel AI program:", error);
    res.status(500).json({ message: "Unable to cancel AI program" });
  }
};

export const skipAIProgram = async (req: Request, res: Response) => {
  try {
    const result = await IrrigationProgram.findOneAndUpdate(
      { programId: req.params.programId, source: "ai-schedule", status: { $in: ["planned", "deferred"] } },
      { $set: { status: "skipped", updatedAt: new Date() } },
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
