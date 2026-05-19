import { z } from "zod";

export const deviceConfigSchema = z.object({
  deviceName: z.string().max(100).optional(),
  deviceDescription: z.string().max(300).optional(),
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