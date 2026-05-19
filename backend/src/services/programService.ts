import IrrigationProgram from "../models/IrrigationProgram";
import type { CreateProgramInput, UpdateProgramInput } from "../schemas/irrigationProgramSchema";
import { emitRealtimeEvent } from "./realtimeService";

export const listPrograms = async () => {
  return IrrigationProgram.find().sort({ createdAt: 1 }).lean();
};

export const getProgram = async (programId: string) => {
  return IrrigationProgram.findOne({ programId }).lean();
};

export const createProgram = async (data: CreateProgramInput) => {
  const program = await IrrigationProgram.create(data);
  const obj = program.toObject();
  emitRealtimeEvent({ type: "program:created", payload: obj });
  return obj;
};

export const updateProgram = async (programId: string, data: UpdateProgramInput) => {
  const program = await IrrigationProgram.findOneAndUpdate(
    { programId },
    { ...data, updatedAt: new Date() },
    { new: true }
  ).lean();
  if (!program) return null;
  emitRealtimeEvent({ type: "program:updated", payload: program });
  return program;
};

export const deleteProgram = async (programId: string) => {
  const result = await IrrigationProgram.findOneAndDelete({ programId }).lean();
  if (result) {
    emitRealtimeEvent({ type: "program:deleted", payload: { programId } });
  }
  return result;
};
