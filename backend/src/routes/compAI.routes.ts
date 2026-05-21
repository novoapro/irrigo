import { Router } from "express";
import { verifyHmacSignature } from "../middleware/verifyHmacSignature";
import {
  handleWebhook,
  getCompAIConfig,
  upsertCompAIConfig,
  testCompAIConnection,
  discoverServices
} from "../controllers/compAIController";

const router = Router();

router.post("/webhook/compai", verifyHmacSignature, handleWebhook);
router.get("/compai/config", getCompAIConfig);
router.put("/compai/config", upsertCompAIConfig);
router.post("/compai/test", testCompAIConnection);
router.get("/compai/services", discoverServices);

export default router;
