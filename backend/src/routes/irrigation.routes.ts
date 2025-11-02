import { Router } from "express";
import {
  createIrrigationEvent,
  createIrrigationEventFromPath,
  listIrrigationEvents
} from "../controllers/irrigationEventController";
import { validateSchema } from "../middleware/validateSchema";
import { irrigationEventSchema } from "../schemas/irrigationEventSchema";

const router = Router();

router.get("/:zone/:state", (req, res) => {
  void createIrrigationEventFromPath(req, res);
});

router.get("/", (req, res) => {
  void listIrrigationEvents(req, res);
});

router.post("/", validateSchema(irrigationEventSchema), (req, res) => {
  void createIrrigationEvent(req, res);
});

export default router;
