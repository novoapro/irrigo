import { Router } from "express";
import { get, update, confirmRain, getRainAlert, dismissRainAlert, clearRainPause } from "../controllers/irrigationSettingsController";
import { validateSchema } from "../middleware/validateSchema";
import { irrigationSettingsSchema } from "../schemas/irrigationSettingsSchema";

const router = Router();

router.get("/", (req, res) => {
  void get(req, res);
});

router.put("/", validateSchema(irrigationSettingsSchema), (req, res) => {
  void update(req, res);
});

router.post("/confirm-rain", (req, res) => {
  void confirmRain(req, res);
});

router.get("/rain-alert", (req, res) => {
  void getRainAlert(req, res);
});

router.post("/dismiss-rain-alert", (req, res) => {
  void dismissRainAlert(req, res);
});

router.post("/clear-rain-pause", (req, res) => {
  void clearRainPause(req, res);
});

export default router;
