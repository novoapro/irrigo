import { Schema, model } from "mongoose";

export type SequentialRunSource = "manual" | "program" | "ai-schedule";
export type SequentialRunStatus = "running" | "deferred" | "completed" | "cancelled" | "failed";
export type SequentialRunZoneStatus = "queued" | "activating" | "running" | "completed" | "skipped" | "failed" | "deferred";

export interface SequentialRunZoneEntry {
  zoneId: string;
  name: string;
  durationMinutes: number;
  status: SequentialRunZoneStatus;
  commandId?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  error?: string | null;
}

export interface SequentialRunAttributes {
  source: SequentialRunSource;
  programId?: string | null;
  status: SequentialRunStatus;
  statusReason?: string | null;
  zones: SequentialRunZoneEntry[];
  currentZoneIndex: number;
  startedAt: Date;
  completedAt?: Date | null;
  deferredAt?: Date | null;
  deferralDeadline?: Date | null;
}

const sequentialRunZoneSchema = new Schema<SequentialRunZoneEntry>(
  {
    zoneId: { type: String, required: true },
    name: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    status: {
      type: String,
      enum: ["queued", "activating", "running", "completed", "skipped", "failed", "deferred"],
      default: "queued"
    },
    commandId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null }
  },
  { _id: false }
);

const sequentialRunSchema = new Schema<SequentialRunAttributes>({
  source: {
    type: String,
    enum: ["manual", "program", "ai-schedule"],
    required: true,
    index: true
  },
  programId: { type: String, default: null },
  status: {
    type: String,
    enum: ["running", "deferred", "completed", "cancelled", "failed"],
    default: "running",
    index: true
  },
  statusReason: { type: String, default: null },
  zones: { type: [sequentialRunZoneSchema], default: [] },
  currentZoneIndex: { type: Number, default: 0 },
  startedAt: { type: Date, default: () => new Date() },
  completedAt: { type: Date, default: null },
  deferredAt: { type: Date, default: null },
  deferralDeadline: { type: Date, default: null }
});

const SequentialRun = model<SequentialRunAttributes>("SequentialRun", sequentialRunSchema);

export default SequentialRun;
