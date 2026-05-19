import { z } from "zod";

export const createCommandSchema = z
  .object({
    action: z.enum(["on", "off"]),
    durationMinutes: z.number().int().positive().optional()
  })
  .strict();

export type CreateCommandInput = z.infer<typeof createCommandSchema>;
