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

export type DebugConfigInput = z.infer<typeof debugConfigSchema>;
export type SimulateWebhookInput = z.infer<typeof simulateWebhookSchema>;
