import { Schema, model, Types } from "mongoose";
import { IRRIGATION_RETENTION_SECONDS } from "../config/persistence";

export type IrrigationSource = "manual" | "program" | "ai-schedule";
export type IrrigationRecordStatus = "running" | "completed" | "failed";

export interface IrrigationRecordAttributes {
  zoneId: string;
  source: IrrigationSource;
  status: IrrigationRecordStatus;
  startedAt: Date;
  endedAt?: Date | null;
  durationMs?: number | null;
  pressureStart?: number | null;
  pressureEnd?: number | null;
  remainingSeconds?: number | null;
  remainingUpdatedAt?: Date | null;
  commandId?: Types.ObjectId | null;
  programId?: string | null;
  scheduleEntryId?: Types.ObjectId | null;
  createdAt?: Date;
}

const irrigationRecordSchema = new Schema<IrrigationRecordAttributes>({
  zoneId: { type: String, required: true, trim: true },
  source: {
    type: String,
    enum: ["manual", "program", "ai-schedule"],
    required: true
  },
  status: {
    type: String,
    enum: ["running", "completed", "failed"],
    default: "running"
  },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  durationMs: { type: Number, default: null },
  pressureStart: { type: Number, default: null },
  pressureEnd: { type: Number, default: null },
  remainingSeconds: { type: Number, default: null },
  remainingUpdatedAt: { type: Date, default: null },
  commandId: {
    type: Schema.Types.ObjectId,
    ref: "IrrigationCommand",
    default: null
  },
  programId: { type: String, default: null },
  scheduleEntryId: {
    type: Schema.Types.ObjectId,
    ref: "ScheduleEntry",
    default: null
  },
  createdAt: { type: Date, default: () => new Date() }
});

irrigationRecordSchema.index({ zoneId: 1, startedAt: -1 });
irrigationRecordSchema.index({ source: 1, startedAt: -1 });
irrigationRecordSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: IRRIGATION_RETENTION_SECONDS, name: "irrigation_record_ttl" }
);

const IrrigationRecord = model<IrrigationRecordAttributes>(
  "IrrigationRecord",
  irrigationRecordSchema
);

export default IrrigationRecord;
