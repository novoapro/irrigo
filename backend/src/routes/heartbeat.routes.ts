import { Router } from "express";
import {
  createHeartbeat,
  getHeartbeatOverview,
  listHeartbeatSeries,
  listHeartbeats
} from "../controllers/heartbeatController";
import { validateSchema } from "../middleware/validateSchema";
import { heartbeatSchema } from "../schemas/heartbeatSchema";

const router = Router();

router.get("/overview", (req, res) => {
  void getHeartbeatOverview(req, res);
});
router.get("/series", (req, res) => {
  void listHeartbeatSeries(req, res);
});
router.get("/", (req, res) => {
  void listHeartbeats(req, res);
});
router.post("/", validateSchema(heartbeatSchema), (req, res) => {
  void createHeartbeat(req, res);
});

export default router;
