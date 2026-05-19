import { Schema, model, Types } from "mongoose";
import { IRRIGATION_RETENTION_SECONDS } from "../config/persistence";

export interface IrrigationEventAttributes {
  zone: string;
  action: "on" | "off";
  waterPressure?: number | null;
  commandId?: Types.ObjectId | null;
  source?: "manual" | "schedule" | "external" | null;
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
    enum: ["manual", "schedule", "external", null],
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
