import { Router } from "express";
import { get, update } from "../controllers/irrigationSettingsController";
import { validateSchema } from "../middleware/validateSchema";
import { irrigationSettingsSchema } from "../schemas/irrigationSettingsSchema";

const router = Router();

router.get("/", (req, res) => {
  void get(req, res);
});

router.put("/", validateSchema(irrigationSettingsSchema), (req, res) => {
  void update(req, res);
});

export default router;
