import { Schema } from "mongoose";
import Config from "../Config";

export interface PreferredTimeWindow {
  startHour: number;
  endHour: number;
}

export type WaterSavingMode = "normal" | "moderate" | "aggressive";

export interface IrrigationSettingsAttributes {
  preferredTimeWindows: PreferredTimeWindow[];
  waterSavingMode: WaterSavingMode;
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
  }
});

const IrrigationSettings = Config.discriminator<IrrigationSettingsAttributes>(
  "irrigationSettings",
  irrigationSettingsSchema
);

export default IrrigationSettings;
