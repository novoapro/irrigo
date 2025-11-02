import { isIP } from "node:net";
import { z } from "zod";

export const sensorsSchema = z.object({
  waterPsi: z.number().min(0, "waterPsi must be >= 0"),
  rain: z.boolean(),
  soil: z.boolean()
});

export const deviceSchema = z.object({
  ip: z
    .string()
    .refine((value) => isIP(value) !== 0, "ip must be a valid IPv4 or IPv6 address"),
  tempF: z.number(),
  humidity: z
    .number()
    .min(0, "humidity must be >= 0")
    .max(100, "humidity must be <= 100"),
  baselinePsi: z.number().min(0, "baselinePsi must be >= 0"),
  connectedSensors: z
    .array(z.enum(["PRESSURE", "RAIN", "SOIL"]))
    .max(3)
    .optional()
});

export const heartbeatSchema = z.object({
  guard: z.boolean(),
  sensors: sensorsSchema,
  device: deviceSchema,
  timestamp: z
    .union([z.coerce.date(), z.undefined()])
    .transform((value) => value ?? undefined)
});

export type HeartbeatInput = z.infer<typeof heartbeatSchema>;
