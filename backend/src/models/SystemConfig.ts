import { Schema, model } from "mongoose";

export type IrrigationMode = "smart" | "manual" | "scheduled";

export interface SystemConfigAttributes {
  irrigationMode: IrrigationMode;
  updatedAt: Date;
}

const systemConfigSchema = new Schema<SystemConfigAttributes>({
  irrigationMode: {
    type: String,
    enum: ["smart", "manual", "scheduled"],
    default: "smart"
  },
  updatedAt: { type: Date, default: () => new Date() }
});

const SystemConfig = model<SystemConfigAttributes>("SystemConfig", systemConfigSchema);

export default SystemConfig;
