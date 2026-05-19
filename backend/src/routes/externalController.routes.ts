import { Router } from "express";
import {
  getExternalControllerConfig,
  upsertExternalControllerConfig,
  testExternalControllerConnection
} from "../controllers/externalControllerConfigController";
import { validateSchema } from "../middleware/validateSchema";
import { externalControllerConfigSchema } from "../schemas/externalControllerConfigSchema";

const router = Router();

router.get("/config", (req, res) => {
  void getExternalControllerConfig(req, res);
});

router.put("/config", validateSchema(externalControllerConfigSchema), (req, res) => {
  void upsertExternalControllerConfig(req, res);
});

router.post("/test", (req, res) => {
  void testExternalControllerConnection(req, res);
});

export default router;
