import { z } from "zod";

const metadataSchema = z
  .object({
    plantType: z.string().trim().optional(),
    sunExposure: z.enum(["full", "partial", "shade"]).optional(),
    soilType: z.string().trim().optional(),
    area: z.number().positive().optional(),
    notes: z.string().trim().optional()
  })
  .strict()
  .optional();

export const createZoneSchema = z
  .object({
    zoneId: z
      .string()
      .trim()
      .min(1, "zoneId is required")
      .max(64, "zoneId must be 64 characters or fewer")
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "zoneId must be a lowercase slug (e.g. front-lawn)"),
    name: z.string().trim().min(1, "name is required").max(128),
    description: z.string().trim().max(512).optional(),
    enabled: z.boolean().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    defaultDurationMinutes: z.number().int().positive("defaultDurationMinutes must be > 0"),
    maxDurationMinutes: z.number().int().positive().optional(),
    metadata: metadataSchema
  })
  .strict();

export const updateZoneSchema = createZoneSchema
  .omit({ zoneId: true })
  .partial()
  .strict();

export const reorderZonesSchema = z
  .object({
    order: z.array(
      z.object({
        zoneId: z.string().trim().min(1),
        sortOrder: z.number().int().nonnegative()
      })
    )
  })
  .strict();

export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;
export type ReorderZonesInput = z.infer<typeof reorderZonesSchema>;
