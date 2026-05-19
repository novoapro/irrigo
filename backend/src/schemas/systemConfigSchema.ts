import { z } from "zod";

export const updateSystemConfigSchema = z
  .object({
    irrigationMode: z.enum(["smart", "manual", "scheduled"])
  })
  .strict();

export type UpdateSystemConfigInput = z.infer<typeof updateSystemConfigSchema>;
