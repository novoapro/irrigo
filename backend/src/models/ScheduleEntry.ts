import { Schema, model } from "mongoose";

export type ScheduleEntryStatus = "planned" | "queued" | "executing" | "completed" | "skipped" | "cancelled";

export interface WeatherContext {
  precipitationProbability: number | null;
  forecastSummary: string | null;
  recentRainDetected: boolean;
}

export interface ScheduleEntryAttributes {
  scheduleRunId: string;
  zoneId: string;
  plannedStartAt: Date;
  plannedDurationMinutes: number;
  status: ScheduleEntryStatus;
  commandId?: string | null;
  aiReasoning: string;
  weatherContext: WeatherContext;
  skipReason?: string | null;
  userModified?: boolean;
  programId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const weatherContextSchema = new Schema(
  {
    precipitationProbability: { type: Number, default: null },
    forecastSummary: { type: String, default: null },
    recentRainDetected: { type: Boolean, default: false }
  },
  { _id: false }
);

const scheduleEntrySchema = new Schema<ScheduleEntryAttributes>({
  scheduleRunId: { type: String, required: true, index: true },
  zoneId: { type: String, required: true, index: true },
  plannedStartAt: { type: Date, required: true, index: true },
  plannedDurationMinutes: { type: Number, required: true },
  status: {
    type: String,
    enum: ["planned", "queued", "executing", "completed", "skipped", "cancelled"],
    default: "planned",
    index: true
  },
  commandId: { type: String, default: null },
  aiReasoning: { type: String, default: "" },
  weatherContext: { type: weatherContextSchema, default: () => ({}) },
  skipReason: { type: String, default: null },
  userModified: { type: Boolean, default: false },
  programId: { type: String, default: null },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() }
});

const ScheduleEntry = model<ScheduleEntryAttributes>("ScheduleEntry", scheduleEntrySchema);

export default ScheduleEntry;
