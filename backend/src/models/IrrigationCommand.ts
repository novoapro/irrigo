import { Schema, model } from "mongoose";

export type CommandStatus = "pending" | "sent" | "acknowledged" | "failed" | "timeout";
export type CommandSource = "manual" | "schedule";

export interface IrrigationCommandAttributes {
  zoneId: string;
  action: "on" | "off";
  durationMinutes?: number | null;
  source: CommandSource;
  status: CommandStatus;
  externalRequestId?: string | null;
  errorMessage?: string | null;
  sentAt?: Date | null;
  acknowledgedAt?: Date | null;
  createdAt?: Date;
}

const irrigationCommandSchema = new Schema<IrrigationCommandAttributes>({
  zoneId: { type: String, required: true, trim: true, index: true },
  action: { type: String, enum: ["on", "off"], required: true },
  durationMinutes: { type: Number, default: null },
  source: { type: String, enum: ["manual", "schedule"], default: "manual" },
  status: {
    type: String,
    enum: ["pending", "sent", "acknowledged", "failed", "timeout"],
    default: "pending",
    index: true
  },
  externalRequestId: { type: String, default: null },
  errorMessage: { type: String, default: null },
  sentAt: { type: Date, default: null },
  acknowledgedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() }
});

irrigationCommandSchema.index({ zoneId: 1, createdAt: -1 });

const IrrigationCommand = model<IrrigationCommandAttributes>(
  "IrrigationCommand",
  irrigationCommandSchema
);

export default IrrigationCommand;
