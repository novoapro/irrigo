import { Schema, model } from "mongoose";

export interface DeviceConfigAttributes {
  deviceIp: string;
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
  deviceIp: { type: String, required: true, unique: true },
  baselineDefault: { type: Number, default: null },
  sampleIntervalMs: { type: Number, default: null },
  heartbeatIntervalMs: { type: Number, default: null },
  psiSpikeDelta: { type: Number, default: null },
  rainEnabled: { type: Boolean, default: true },
  moistEnabled: { type: Boolean, default: true },
  guardEnabled: { type: Boolean, default: true },
  forceHeartbeat: { type: Boolean, default: false },
  updatedAt: { type: Date, default: () => new Date() }
});

const DeviceConfig = model<DeviceConfigAttributes>("DeviceConfig", deviceConfigSchema);

export default DeviceConfig;
