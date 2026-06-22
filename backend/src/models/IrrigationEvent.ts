import { Schema, model, Types } from "mongoose";
import { IRRIGATION_RETENTION_SECONDS } from "../config/persistence";

export interface IrrigationEventAttributes {
  zone: string;
  action: "on" | "off";
  waterPressure?: number | null;
  commandId?: Types.ObjectId | null;
  // Must accept every IrrigationCommand source (a webhook-confirmed event copies the
  // acknowledged command's source) plus "external" for events with no owning command.
  // If a scheduled/AI source is missing here, persistEvent throws on create and the
  // run's events/records are lost and onZoneOff never fires — see CommandSource.
  source?: "manual" | "schedule" | "program" | "ai-schedule" | "external" | null;
  createdAt?: Date;
}

const irrigationEventSchema = new Schema<IrrigationEventAttributes>({
  zone: {
    type: String,
    required: true,
    trim: true
  },
  action: {
    type: String,
    enum: ["on", "off"],
    required: true
  },
  waterPressure: {
    type: Number,
    default: null
  },
  commandId: {
    type: Schema.Types.ObjectId,
    ref: "IrrigationCommand",
    default: null
  },
  source: {
    type: String,
    enum: ["manual", "schedule", "program", "ai-schedule", "external", null],
    default: null
  },
  createdAt: {
    type: Date,
    default: () => new Date()
  }
});

irrigationEventSchema.index({ zone: 1, createdAt: -1 });
irrigationEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: IRRIGATION_RETENTION_SECONDS, name: "irrigation_ttl" }
);

const IrrigationEvent = model<IrrigationEventAttributes>(
  "IrrigationEvent",
  irrigationEventSchema
);

export default IrrigationEvent;
