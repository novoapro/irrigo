import { Router } from "express";
import { triggerManualRun } from "../controllers/manualRunController";

const router = Router();

router.post("/", (req, res) => {
  void triggerManualRun(req, res);
});

export default router;
