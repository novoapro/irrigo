import { Schema, model } from "mongoose";

export interface ExternalControllerConfigAttributes {
  name: string;
  endpoint: string;
  authType: "none" | "bearer" | "apikey" | "basic";
  authToken?: string | null;
  zoneMapping?: Record<string, string>;
  commandPath?: string;
  timeoutMs: number;
  enabled: boolean;
  updatedAt?: Date;
}

const externalControllerConfigSchema = new Schema<ExternalControllerConfigAttributes>({
  name: { type: String, required: true, trim: true },
  endpoint: { type: String, required: true, trim: true },
  authType: { type: String, enum: ["none", "bearer", "apikey", "basic"], default: "none" },
  authToken: { type: String, default: null },
  zoneMapping: { type: Schema.Types.Mixed, default: {} },
  commandPath: { type: String, default: null, trim: true },
  timeoutMs: { type: Number, default: 10000 },
  enabled: { type: Boolean, default: true },
  updatedAt: { type: Date, default: () => new Date() }
});

const ExternalControllerConfig = model<ExternalControllerConfigAttributes>(
  "ExternalControllerConfig",
  externalControllerConfigSchema
);

export default ExternalControllerConfig;
