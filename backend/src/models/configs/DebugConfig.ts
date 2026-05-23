import { Schema } from "mongoose";
import Config from "../Config";

export interface DebugConfigAttributes {
  enabled: boolean;
  updatedAt?: Date;
}

const debugConfigSchema = new Schema<DebugConfigAttributes>({
  enabled: { type: Boolean, default: false }
});

const DebugConfig = Config.discriminator<DebugConfigAttributes>(
  "debug",
  debugConfigSchema
);

export default DebugConfig;
