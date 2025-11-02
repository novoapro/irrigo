import { Router } from "express";
import { getDeviceConfig, upsertDeviceConfig } from "../controllers/deviceConfigController";
import { validateSchema } from "../middleware/validateSchema";
import { deviceConfigSchema } from "../schemas/deviceConfigSchema";

const router = Router();

router.get("/config/:ip?", (req, res) => {
  void getDeviceConfig(req, res);
});

router.put("/config/:ip?", validateSchema(deviceConfigSchema), (req, res) => {
  void upsertDeviceConfig(req, res);
});

export default router;
