import { Router } from "express";
import { validateSchema } from "../middleware/validateSchema";
import { debugConfigSchema, simulateWebhookSchema } from "../schemas/debugConfigSchema";
import {
  getDebugConfig,
  upsertDebugConfig,
  simulateWebhook,
  getZonesForDebug
} from "../controllers/debugController";

const router = Router();

router.get("/config", getDebugConfig);
router.put("/config", validateSchema(debugConfigSchema), upsertDebugConfig);
router.post("/simulate-event", validateSchema(simulateWebhookSchema), simulateWebhook);
router.get("/zones", getZonesForDebug);

export default router;
