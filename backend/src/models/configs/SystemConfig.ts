import { Schema } from "mongoose";
import Config from "../Config";

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
  }
});

const SystemConfig = Config.discriminator<SystemConfigAttributes>(
  "system",
  systemConfigSchema
);

export default SystemConfig;
