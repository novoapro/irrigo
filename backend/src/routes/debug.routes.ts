import { Router } from "express";
import { validateSchema } from "../middleware/validateSchema";
import { debugConfigSchema, simulateWebhookSchema, simulateCharacteristicSchema } from "../schemas/debugConfigSchema";
import {
  getDebugConfig,
  upsertDebugConfig,
  simulateWebhook,
  simulateCharacteristic,
  getZonesForDebug
} from "../controllers/debugController";

const router = Router();

router.get("/config", getDebugConfig);
router.put("/config", validateSchema(debugConfigSchema), upsertDebugConfig);
router.post("/simulate-event", validateSchema(simulateWebhookSchema), simulateWebhook);
router.post("/simulate-characteristic", validateSchema(simulateCharacteristicSchema), simulateCharacteristic);
router.get("/zones", getZonesForDebug);

export default router;
