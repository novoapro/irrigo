import { Schema, model } from "mongoose";
import { randomUUID } from "node:crypto";
import type { WeatherContext } from "./ScheduleEntry";

export type ProgramSource = "manual" | "ai-schedule";
export type ProgramStatus = "planned" | "executing" | "completed" | "cancelled" | "skipped" | "deferred";

export interface ProgramZoneEntry {
  zoneId: string;
  durationMinutes: number;
}

export interface IrrigationProgramAttributes {
  programId: string;
  name: string;
  enabled: boolean;
  source: ProgramSource;
  scheduleCron?: string;
  plannedStartAt?: Date;
  status: ProgramStatus;
  statusReason?: string;
  scheduleRunId?: string;
  aiReasoning?: string;
  weatherContext?: WeatherContext;
  deferredAt?: Date;
  deferralDeadline?: Date;
  zoneEntries: ProgramZoneEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const weatherContextSchema = new Schema(
  {
    precipitationProbability: { type: Number, default: null },
    forecastSummary: { type: String, default: null },
    recentRainDetected: { type: Boolean, default: false }
  },
  { _id: false }
);

const programZoneEntrySchema = new Schema<ProgramZoneEntry>(
  {
    zoneId: { type: String, required: true },
    durationMinutes: { type: Number, required: true, min: 1 }
  },
  { _id: false }
);

const irrigationProgramSchema = new Schema<IrrigationProgramAttributes>({
  programId: { type: String, required: true, unique: true, default: () => randomUUID() },
  name: { type: String, required: true, trim: true },
  enabled: { type: Boolean, default: true },
  source: { type: String, enum: ["manual", "ai-schedule"], default: "manual", index: true },
  scheduleCron: { type: String, default: null },
  plannedStartAt: { type: Date, default: null, index: true },
  status: {
    type: String,
    enum: ["planned", "executing", "completed", "cancelled", "skipped", "deferred"],
    default: "planned",
    index: true
  },
  statusReason: { type: String, default: null },
  scheduleRunId: { type: String, default: null, index: true },
  aiReasoning: { type: String, default: null },
  weatherContext: { type: weatherContextSchema, default: null },
  deferredAt: { type: Date, default: null },
  deferralDeadline: { type: Date, default: null },
  zoneEntries: { type: [programZoneEntrySchema], default: [] },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() }
});

const IrrigationProgram = model<IrrigationProgramAttributes>("IrrigationProgram", irrigationProgramSchema);

export default IrrigationProgram;
