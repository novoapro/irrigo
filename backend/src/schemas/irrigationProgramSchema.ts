import { z } from "zod";

const zoneEntrySchema = z.object({
  zoneId: z.string().trim().min(1, "zoneId is required"),
  durationMinutes: z.number().int().positive("durationMinutes must be > 0").max(480)
});

export const createProgramSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(128),
    enabled: z.boolean().optional(),
    scheduleCron: z.string().trim().min(1, "scheduleCron is required"),
    zoneEntries: z.array(zoneEntrySchema).min(1, "At least one zone entry is required"),
    deferralEnabled: z.boolean().optional(),
    deferralWindowMinutes: z.number().int().min(15).max(480).optional()
  })
  .strict();

export const updateProgramSchema = createProgramSchema.partial().strict();

export type CreateProgramInput = z.infer<typeof createProgramSchema>;
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;
