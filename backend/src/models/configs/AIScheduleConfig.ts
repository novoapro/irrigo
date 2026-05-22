import { Schema } from "mongoose";
import Config from "../Config";

export interface PreferredTimeWindow {
  startHour: number;
  endHour: number;
}

export interface AISchedulePreferences {
  conservativeWatering: boolean;
  rainThresholdPercent: number;
  recentRainWindowHours: number;
  preferredTimeWindows: PreferredTimeWindow[];
  maxDailyRunMinutes: number;
  minDaysBetweenRuns: number;
  waterSavingMode: "normal" | "moderate" | "aggressive";
}

export interface AIScheduleConfigAttributes {
  enabled: boolean;
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
  scheduleCron: string;
  evaluationWindowHours: number;
  userContext: string;
  preferences: AISchedulePreferences;
  lastRunAt?: Date | null;
  lastRunStatus?: "success" | "error" | "skipped" | null;
  lastRunMessage?: string | null;
  updatedAt?: Date;
}

const preferredTimeWindowSchema = new Schema(
  {
    startHour: { type: Number, required: true, min: 0, max: 23 },
    endHour: { type: Number, required: true, min: 0, max: 23 }
  },
  { _id: false }
);

const preferencesSchema = new Schema(
  {
    conservativeWatering: { type: Boolean, default: true },
    rainThresholdPercent: { type: Number, default: 40, min: 0, max: 100 },
    recentRainWindowHours: { type: Number, default: 48, min: 1 },
    preferredTimeWindows: { type: [preferredTimeWindowSchema], default: [{ startHour: 20, endHour: 6 }] },
    maxDailyRunMinutes: { type: Number, default: 120, min: 1 },
    minDaysBetweenRuns: { type: Number, default: 1, min: 0 },
    waterSavingMode: { type: String, enum: ["normal", "moderate", "aggressive"], default: "normal" }
  },
  { _id: false }
);

const aiScheduleConfigSchema = new Schema<AIScheduleConfigAttributes>({
  enabled: { type: Boolean, default: false },
  provider: { type: String, enum: ["anthropic", "openai"], default: "anthropic" },
  model: { type: String, default: "claude-sonnet-4-20250514" },
  apiKey: { type: String, default: "" },
  scheduleCron: { type: String, default: "0 4 * * *" },
  evaluationWindowHours: { type: Number, default: 24, min: 1, max: 72 },
  userContext: { type: String, default: "" },
  preferences: { type: preferencesSchema, default: () => ({}) },
  lastRunAt: { type: Date, default: null },
  lastRunStatus: { type: String, enum: ["success", "error", "skipped", null], default: null },
  lastRunMessage: { type: String, default: null }
});

const AIScheduleConfig = Config.discriminator<AIScheduleConfigAttributes>(
  "aiSchedule",
  aiScheduleConfigSchema
);

export default AIScheduleConfig;
