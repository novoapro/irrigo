import { Schema, model } from "mongoose";

export interface RequestParams {
  provider: string;
  model: string;
  maxTokens: number;
}

export interface ScheduleRunAttributes {
  scheduleRunId: string;
  triggeredBy: "cron" | "manual";
  status: "running" | "completed" | "error";
  aiProvider: string;
  aiModel: string;
  promptTokens?: number;
  completionTokens?: number;
  entries: number;
  reasoning: string;
  errorMessage?: string | null;
  systemPrompt?: string | null;
  userPrompt?: string | null;
  rawResponse?: string | null;
  requestParams?: RequestParams | null;
  startedAt: Date;
  completedAt?: Date | null;
}

const scheduleRunSchema = new Schema<ScheduleRunAttributes>({
  scheduleRunId: { type: String, required: true, unique: true, index: true },
  triggeredBy: { type: String, enum: ["cron", "manual"], required: true },
  status: { type: String, enum: ["running", "completed", "error"], default: "running" },
  aiProvider: { type: String, required: true },
  aiModel: { type: String, required: true },
  promptTokens: { type: Number, default: null },
  completionTokens: { type: Number, default: null },
  entries: { type: Number, default: 0 },
  reasoning: { type: String, default: "" },
  errorMessage: { type: String, default: null },
  systemPrompt: { type: String, default: null },
  userPrompt: { type: String, default: null },
  rawResponse: { type: String, default: null },
  requestParams: {
    type: new Schema<RequestParams>({
      provider: { type: String },
      model: { type: String },
      maxTokens: { type: Number }
    }, { _id: false }),
    default: null
  },
  startedAt: { type: Date, required: true },
  completedAt: { type: Date, default: null }
});

const ScheduleRun = model<ScheduleRunAttributes>("ScheduleRun", scheduleRunSchema);

export default ScheduleRun;
