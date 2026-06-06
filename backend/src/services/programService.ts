import IrrigationProgram from "../models/IrrigationProgram";
import ScheduleEntry from "../models/ScheduleEntry";
import type { CreateProgramInput, UpdateProgramInput } from "../schemas/irrigationProgramSchema";
import { emitRealtimeEvent } from "./realtimeService";

export const listPrograms = async (filter?: { source?: string; status?: string | string[] }) => {
  const query: Record<string, unknown> = {};
  if (filter?.source) {
    if (filter.source === "manual") {
      query.source = { $in: ["manual", null] };
    } else {
      query.source = filter.source;
    }
  }
  if (filter?.status) {
    query.status = Array.isArray(filter.status) ? { $in: filter.status } : filter.status;
  }
  return IrrigationProgram.find(query).sort({ createdAt: 1 }).lean();
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
  await ScheduleEntry.deleteMany({
    programId,
    status: { $in: ["planned", "skipped"] }
  });
  emitRealtimeEvent({ type: "program:updated", payload: program });
  return program;
};

export const deleteProgram = async (programId: string) => {
  const result = await IrrigationProgram.findOneAndDelete({ programId }).lean();
  if (result) {
    await ScheduleEntry.updateMany(
      { programId, status: "planned" },
      { status: "cancelled" }
    );
    emitRealtimeEvent({ type: "program:deleted", payload: { programId } });
  }
  return result;
};
