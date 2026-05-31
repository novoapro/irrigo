import { Router } from "express";
import { verifyHmacSignature } from "../middleware/verifyHmacSignature";
import {
  handleWebhook,
  getCompAIConfig,
  upsertCompAIConfig,
  testCompAIConnection,
  discoverServices,
  listWebhookEvents,
  deleteWebhookEvents
} from "../controllers/compAIController";

const router = Router();

router.post("/webhook/compai", verifyHmacSignature, handleWebhook);
router.get("/compai/config", getCompAIConfig);
router.put("/compai/config", upsertCompAIConfig);
router.post("/compai/test", testCompAIConnection);
router.get("/compai/services", discoverServices);
router.get("/compai/events", listWebhookEvents);
router.delete("/compai/events", deleteWebhookEvents);

export default router;
