import { z } from "zod";

export const irrigationEventSchema = z
  .object({
    zone: z
      .string()
      .trim()
      .min(1, "zone is required"),
    state: z.enum(["on", "off"]).describe("Irrigation state change")
  })
  .strict();

export type IrrigationEventInput = z.infer<typeof irrigationEventSchema>;
