import { Router } from "express";
import { triggerManualRun, handleCancelManualRun, handleGetManualRunStatus } from "../controllers/manualRunController";

const router = Router();

router.post("/", (req, res) => {
  void triggerManualRun(req, res);
});

router.delete("/", (req, res) => {
  void handleCancelManualRun(req, res);
});

router.get("/status", (req, res) => {
  void handleGetManualRunStatus(req, res);
});

export default router;
