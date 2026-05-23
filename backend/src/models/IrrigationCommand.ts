import { Schema, model } from "mongoose";
import { IRRIGATION_RETENTION_SECONDS } from "../config/persistence";

export type CommandStatus = "pending" | "sent" | "acknowledged" | "failed" | "timeout";
export type CommandSource = "manual" | "schedule" | "program" | "ai-schedule";
export type ControllerMethod = "compai" | "external" | "debug";

export interface IrrigationCommandAttributes {
  zoneId: string;
  action: "on" | "off";
  durationMinutes?: number | null;
  source: CommandSource;
  status: CommandStatus;
  externalRequestId?: string | null;
  errorMessage?: string | null;
  controllerMethod?: ControllerMethod | null;
  controllerUrl?: string | null;
  controllerResponseStatus?: number | null;
  controllerResponseBody?: string | null;
  sentAt?: Date | null;
  acknowledgedAt?: Date | null;
  createdAt?: Date;
}

const irrigationCommandSchema = new Schema<IrrigationCommandAttributes>({
  zoneId: { type: String, required: true, trim: true, index: true },
  action: { type: String, enum: ["on", "off"], required: true },
  durationMinutes: { type: Number, default: null },
  source: { type: String, enum: ["manual", "schedule", "program", "ai-schedule"], default: "manual" },
  status: {
    type: String,
    enum: ["pending", "sent", "acknowledged", "failed", "timeout"],
    default: "pending",
    index: true
  },
  externalRequestId: { type: String, default: null },
  errorMessage: { type: String, default: null },
  controllerMethod: { type: String, enum: ["compai", "external", "debug", null], default: null },
  controllerUrl: { type: String, default: null },
  controllerResponseStatus: { type: Number, default: null },
  controllerResponseBody: { type: String, default: null },
  sentAt: { type: Date, default: null },
  acknowledgedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() }
});

irrigationCommandSchema.index({ zoneId: 1, createdAt: -1 });
irrigationCommandSchema.index({ createdAt: 1 }, { expireAfterSeconds: IRRIGATION_RETENTION_SECONDS });

const IrrigationCommand = model<IrrigationCommandAttributes>(
  "IrrigationCommand",
  irrigationCommandSchema
);

export default IrrigationCommand;
