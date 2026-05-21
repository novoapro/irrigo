import { z } from "zod";

const preferredTimeWindowSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23)
});

const preferencesSchema = z.object({
  conservativeWatering: z.boolean().optional(),
  rainThresholdPercent: z.number().min(0).max(100).optional(),
  recentRainWindowHours: z.number().int().positive().optional(),
  preferredTimeWindows: z.array(preferredTimeWindowSchema).optional(),
  maxDailyRunMinutes: z.number().int().positive().optional(),
  minDaysBetweenRuns: z.number().int().nonnegative().optional(),
  waterSavingMode: z.enum(["normal", "moderate", "aggressive"]).optional()
}).strict().optional();

export const aiScheduleConfigSchema = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(["anthropic", "openai"]).optional(),
  model: z.string().trim().min(1).optional(),
  apiKey: z.string().optional(),
  scheduleCron: z.string().trim().optional(),
  evaluationWindowHours: z.number().int().min(1).max(168).optional(),
  userContext: z.string().max(2000).optional(),
  preferences: preferencesSchema
}).strict();

export type AIScheduleConfigInput = z.infer<typeof aiScheduleConfigSchema>;
