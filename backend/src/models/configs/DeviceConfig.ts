import { Schema } from "mongoose";
import Config from "../Config";

export interface DeviceConfigAttributes {
  deviceIp: string;
  deviceName?: string;
  deviceDescription?: string;
  baselineDefault?: number;
  sampleIntervalMs?: number;
  heartbeatIntervalMs?: number;
  psiSpikeDelta?: number;
  rainEnabled?: boolean;
  moistEnabled?: boolean;
  guardEnabled?: boolean;
  forceHeartbeat?: boolean;
  updatedAt?: Date;
}

const deviceConfigSchema = new Schema<DeviceConfigAttributes>({
  deviceIp: { type: String, required: true },
  deviceName: { type: String, default: null },
  deviceDescription: { type: String, default: null },
  baselineDefault: { type: Number, default: null },
  sampleIntervalMs: { type: Number, default: null },
  heartbeatIntervalMs: { type: Number, default: null },
  psiSpikeDelta: { type: Number, default: null },
  rainEnabled: { type: Boolean, default: true },
  moistEnabled: { type: Boolean, default: true },
  guardEnabled: { type: Boolean, default: true },
  forceHeartbeat: { type: Boolean, default: false }
});

deviceConfigSchema.index(
  { deviceIp: 1 },
  { unique: true, partialFilterExpression: { type: "device" } }
);

const DeviceConfig = Config.discriminator<DeviceConfigAttributes>(
  "device",
  deviceConfigSchema
);

export default DeviceConfig;
