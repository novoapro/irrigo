import { Schema } from "mongoose";
import Config from "../Config";

export interface PreferredTimeWindow {
  startHour: number;
  endHour: number;
}

export type WaterSavingMode = "normal" | "moderate" | "aggressive";
export type RainIntensity = "light" | "moderate" | "heavy";
export type RainPromptResponse = "confirmed" | "dismissed";

export interface IrrigationSettingsAttributes {
  preferredTimeWindows: PreferredTimeWindow[];
  waterSavingMode: WaterSavingMode;
  // How long any program (AI or manual) may be deferred past its scheduled start before
  // it is skipped. An execution-time setting: the deferral deadline is always measured as
  // plannedStartAt + maxDeferralHours, regardless of when the deferral was triggered.
  // 0 ⇒ no deferral (skip immediately if it cannot run at its scheduled time).
  maxDeferralHours: number;
  rainPauseHours: number;
  lastConfirmedRainAt: Date | null;
  lastConfirmedRainIntensity: RainIntensity | null;
  // Watermark set when the user manually removes the rain pause. Any rain event (sensor
  // or user-confirmed) at or before this instant is ignored when computing the pause, so a
  // still-standing sensor detection can be cleared without deleting heartbeat data.
  rainPauseClearedAt: Date | null;
  // When (and how) the user last answered the rain prompt — confirmed rain or dismissed
  // it. Gates the rain alert to at most one prompt per calendar day (settings timezone).
  lastRainPromptRespondedAt: Date | null;
  lastRainPromptResponse: RainPromptResponse | null;
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
  maxDeferralHours: {
    type: Number,
    default: 6,
    min: 0,
    max: 168
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
  rainPauseClearedAt: {
    type: Date,
    default: null
  },
  lastRainPromptRespondedAt: {
    type: Date,
    default: null
  },
  lastRainPromptResponse: {
    type: String,
    enum: ["confirmed", "dismissed", null],
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
