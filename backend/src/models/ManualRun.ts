import { Schema, model } from "mongoose";

export type ManualRunStatus = "running" | "completed" | "cancelled" | "failed";
export type ManualRunZoneStatus = "queued" | "activating" | "running" | "completed" | "skipped" | "failed";

export interface ManualRunZoneEntry {
  zoneId: string;
  name: string;
  durationMinutes: number;
  status: ManualRunZoneStatus;
  commandId?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  error?: string | null;
}

export interface ManualRunAttributes {
  status: ManualRunStatus;
  zones: ManualRunZoneEntry[];
  currentZoneIndex: number;
  startedAt: Date;
  completedAt?: Date | null;
}

const manualRunZoneSchema = new Schema<ManualRunZoneEntry>(
  {
    zoneId: { type: String, required: true },
    name: { type: String, required: true },
    durationMinutes: { type: Number, required: true },
    status: {
      type: String,
      enum: ["queued", "activating", "running", "completed", "skipped", "failed"],
      default: "queued"
    },
    commandId: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    error: { type: String, default: null }
  },
  { _id: false }
);

const manualRunSchema = new Schema<ManualRunAttributes>({
  status: {
    type: String,
    enum: ["running", "completed", "cancelled", "failed"],
    default: "running",
    index: true
  },
  zones: { type: [manualRunZoneSchema], default: [] },
  currentZoneIndex: { type: Number, default: 0 },
  startedAt: { type: Date, default: () => new Date() },
  completedAt: { type: Date, default: null }
});

const ManualRun = model<ManualRunAttributes>("ManualRun", manualRunSchema);

export default ManualRun;
