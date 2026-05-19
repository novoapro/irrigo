import { z } from "zod";

export const externalControllerConfigSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(128),
    endpoint: z.string().trim().url("endpoint must be a valid URL"),
    authType: z.enum(["none", "bearer", "apikey", "basic"]).optional(),
    authToken: z.string().trim().optional().nullable(),
    zoneMapping: z.record(z.string(), z.string()).optional(),
    commandPath: z.string().trim().optional().nullable(),
    timeoutMs: z.number().int().positive().optional(),
    enabled: z.boolean().optional()
  })
  .strict();

export type ExternalControllerConfigInput = z.infer<typeof externalControllerConfigSchema>;
