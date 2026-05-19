import { Router } from "express";
import { getConfig, updateConfig } from "../controllers/systemConfigController";
import { validateSchema } from "../middleware/validateSchema";
import { updateSystemConfigSchema } from "../schemas/systemConfigSchema";

const router = Router();

router.get("/", (req, res) => {
  void getConfig(req, res);
});

router.put("/", validateSchema(updateSystemConfigSchema), (req, res) => {
  void updateConfig(req, res);
});

export default router;
