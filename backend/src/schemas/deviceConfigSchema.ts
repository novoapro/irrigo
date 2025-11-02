import { z } from "zod";

export const deviceConfigSchema = z.object({
  // baselineDefault should allow zero (explicitly set to 0 to disable baseline)
  baselineDefault: z.number().nonnegative().optional(),
  sampleIntervalMs: z.number().int().positive().optional(),
  heartbeatIntervalMs: z.number().int().positive().optional(),
  psiSpikeDelta: z.number().positive().optional(),
  rainEnabled: z.boolean().optional(),
  moistEnabled: z.boolean().optional(),
  guardEnabled: z.boolean().optional(),
  forceHeartbeat: z.boolean().optional(),
  deviceIp: z.string().optional(),
});

export type DeviceConfigInput = z.infer<typeof deviceConfigSchema>;