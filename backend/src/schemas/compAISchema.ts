import { z } from "zod";

export const compAIConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    deviceId: z.string().trim().min(1, "deviceId is required"),
    endpoint: z.string().trim().nullable().optional(),
    authType: z.enum(["none", "bearer", "apikey", "basic"]).optional(),
    authToken: z.string().trim().nullable().optional(),
    timeoutMs: z.number().int().positive().optional(),
    webhookSecret: z.string().trim().nullable().optional()
  })
  .strict();

export const compAIWebhookPayloadSchema = z
  .object({
    timestamp: z.string(),
    deviceId: z.string(),
    deviceName: z.string().optional(),
    serviceId: z.string(),
    serviceName: z.string().optional(),
    characteristicId: z.string(),
    characteristicType: z.string(),
    characteristicName: z.string().optional(),
    oldValue: z.any().nullable(),
    newValue: z.any().nullable()
  });

export type CompAIConfigInput = z.infer<typeof compAIConfigSchema>;
export type CompAIWebhookPayload = z.infer<typeof compAIWebhookPayloadSchema>;
