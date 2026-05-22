import { Schema } from "mongoose";
import Config from "../Config";

export interface CompAIConfigAttributes {
  enabled: boolean;
  deviceId: string;
  endpoint?: string | null;
  authType: "none" | "bearer" | "apikey" | "basic";
  authToken?: string | null;
  timeoutMs: number;
  webhookSecret?: string | null;
  lastWebhookAt?: Date | null;
  updatedAt?: Date;
}

const compAIConfigSchema = new Schema<CompAIConfigAttributes>({
  enabled: { type: Boolean, default: false },
  deviceId: { type: String, required: true, trim: true },
  endpoint: { type: String, default: null, trim: true },
  authType: { type: String, enum: ["none", "bearer", "apikey", "basic"], default: "none" },
  authToken: { type: String, default: null },
  timeoutMs: { type: Number, default: 10000 },
  webhookSecret: { type: String, default: null },
  lastWebhookAt: { type: Date, default: null }
});

const CompAIConfig = Config.discriminator<CompAIConfigAttributes>(
  "compAI",
  compAIConfigSchema
);

export default CompAIConfig;
