import { z } from "zod";

export const debugConfigSchema = z
  .object({
    enabled: z.boolean().optional()
  })
  .strict();

export const simulateWebhookSchema = z.object({
  zoneId: z.string().min(1),
  action: z.enum(["on", "off"])
});

export const simulateCharacteristicSchema = z.object({
  zoneId: z.string().min(1),
  characteristic: z.enum(["active", "inUse", "isConfigured", "setDuration", "remainingDuration"]),
  value: z.number()
});

export type DebugConfigInput = z.infer<typeof debugConfigSchema>;
export type SimulateWebhookInput = z.infer<typeof simulateWebhookSchema>;
export type SimulateCharacteristicInput = z.infer<typeof simulateCharacteristicSchema>;
