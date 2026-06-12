import { Schema } from "mongoose";
import Config from "../Config";

export interface PreferredTimeWindow {
  startHour: number;
  endHour: number;
}

export type WaterSavingMode = "normal" | "moderate" | "aggressive";
export type RainIntensity = "light" | "moderate" | "heavy";

export interface IrrigationSettingsAttributes {
  preferredTimeWindows: PreferredTimeWindow[];
  waterSavingMode: WaterSavingMode;
  rainPauseHours: number;
  lastConfirmedRainAt: Date | null;
  lastConfirmedRainIntensity: RainIntensity | null;
  timezone: string;
  updatedAt: Date;
}

const preferredTimeWindowSchema = new Schema(
  {
    startHour: { type: Number, required: true, min: 0, max: 23 },
    endHour: { type: Number, required: true, min: 0, max: 23 }
  },
  { _id: false }
);

const irrigationSettingsSchema = new Schema<IrrigationSettingsAttributes>({
  preferredTimeWindows: {
    type: [preferredTimeWindowSchema],
    default: [{ startHour: 20, endHour: 6 }]
  },
  waterSavingMode: {
    type: String,
    enum: ["normal", "moderate", "aggressive"],
    default: "normal"
  },
  rainPauseHours: {
    type: Number,
    default: 48,
    min: 0,
    max: 168
  },
  lastConfirmedRainAt: {
    type: Date,
    default: null
  },
  lastConfirmedRainIntensity: {
    type: String,
    enum: ["light", "moderate", "heavy", null],
    default: null
  },
  timezone: {
    type: String,
    default: "America/New_York"
  }
});

const IrrigationSettings = Config.discriminator<IrrigationSettingsAttributes>(
  "irrigationSettings",
  irrigationSettingsSchema
);

export default IrrigationSettings;
