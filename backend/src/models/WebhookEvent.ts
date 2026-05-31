import { Schema, model } from "mongoose";
import { IRRIGATION_RETENTION_SECONDS } from "../config/persistence";

export interface WebhookEventAttributes {
  deviceId: string;
  serviceId: string;
  serviceName?: string | null;
  characteristicId: string;
  characteristicType: string;
  characteristicName?: string | null;
  oldValue: unknown;
  newValue: unknown;
  zoneId?: string | null;
  zoneName?: string | null;
  processed: boolean;
  result?: string | null;
  receivedAt: Date;
}

const webhookEventSchema = new Schema<WebhookEventAttributes>({
  deviceId: { type: String, required: true },
  serviceId: { type: String, required: true },
  serviceName: { type: String, default: null },
  characteristicId: { type: String, required: true },
  characteristicType: { type: String, required: true },
  characteristicName: { type: String, default: null },
  oldValue: { type: Schema.Types.Mixed, default: null },
  newValue: { type: Schema.Types.Mixed, default: null },
  zoneId: { type: String, default: null },
  zoneName: { type: String, default: null },
  processed: { type: Boolean, required: true },
  result: { type: String, default: null },
  receivedAt: { type: Date, required: true }
});

webhookEventSchema.index({ receivedAt: -1 });
webhookEventSchema.index({ zoneId: 1, receivedAt: -1 });
webhookEventSchema.index(
  { receivedAt: 1 },
  { expireAfterSeconds: IRRIGATION_RETENTION_SECONDS, name: "webhook_event_ttl" }
);

const WebhookEvent = model<WebhookEventAttributes>(
  "WebhookEvent",
  webhookEventSchema
);

export default WebhookEvent;
