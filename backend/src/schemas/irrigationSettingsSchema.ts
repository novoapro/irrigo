import { z } from "zod";

const preferredTimeWindowSchema = z.object({
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(23)
});

export const irrigationSettingsSchema = z.object({
  preferredTimeWindows: z.array(preferredTimeWindowSchema).min(1).optional(),
  waterSavingMode: z.enum(["normal", "moderate", "aggressive"]).optional(),
  timezone: z.string().min(1).optional()
}).strict();

export type IrrigationSettingsInput = z.infer<typeof irrigationSettingsSchema>;
