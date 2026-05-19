import { Schema, model } from "mongoose";

export interface ZoneMetadata {
  plantType?: string;
  sunExposure?: "full" | "partial" | "shade";
  soilType?: string;
  area?: number;
  notes?: string;
}

export interface ZoneAttributes {
  zoneId: string;
  name: string;
  description?: string;
  enabled: boolean;
  sortOrder: number;
  defaultDurationMinutes: number;
  maxDurationMinutes: number;
  metadata?: ZoneMetadata;
  createdAt?: Date;
  updatedAt?: Date;
}

const zoneSchema = new Schema<ZoneAttributes>({
  zoneId: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: null, trim: true },
  enabled: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  defaultDurationMinutes: { type: Number, required: true },
  maxDurationMinutes: { type: Number, default: 60 },
  metadata: {
    type: new Schema(
      {
        plantType: { type: String, default: null },
        sunExposure: { type: String, enum: ["full", "partial", "shade"], default: null },
        soilType: { type: String, default: null },
        area: { type: Number, default: null },
        notes: { type: String, default: null }
      },
      { _id: false }
    ),
    default: undefined
  },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() }
});

const Zone = model<ZoneAttributes>("Zone", zoneSchema);

export default Zone;
