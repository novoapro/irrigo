import { Schema, model } from "mongoose";

export interface CompAIConfigAttributes {
  enabled: boolean;
  deviceId: string;

  // Outbound (commands)
  endpoint?: string | null;
  authType: "none" | "bearer" | "apikey" | "basic";
  authToken?: string | null;
  timeoutMs: number;

  // Inbound (webhooks)
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
  lastWebhookAt: { type: Date, default: null },

  updatedAt: { type: Date, default: () => new Date() }
});

const CompAIConfig = model<CompAIConfigAttributes>("CompAIConfig", compAIConfigSchema);

export default CompAIConfig;
