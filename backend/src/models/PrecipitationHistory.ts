import { Schema, model } from "mongoose";
import { PRECIPITATION_RETENTION_SECONDS } from "../config/persistence";

export interface PrecipitationHistoryAttributes {
  periodStart: Date;
  probability: number;
  fetchedAt: Date;
  office: string;
  gridX: number;
  gridY: number;
}

const precipitationHistorySchema = new Schema<PrecipitationHistoryAttributes>({
  periodStart: { type: Date, required: true },
  probability: { type: Number, required: true },
  fetchedAt: { type: Date, required: true, default: () => new Date() },
  office: { type: String, required: true },
  gridX: { type: Number, required: true },
  gridY: { type: Number, required: true }
});

precipitationHistorySchema.index(
  { periodStart: 1 },
  {
    expireAfterSeconds: PRECIPITATION_RETENTION_SECONDS,
    name: "precip_history_ttl"
  }
);

const PrecipitationHistory = model<PrecipitationHistoryAttributes>(
  "PrecipitationHistory",
  precipitationHistorySchema
);

export default PrecipitationHistory;
