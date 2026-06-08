import { Router } from "express";
import { getSystemStatus, listStatusSnapshots } from "../controllers/statusController";
import { getStateSnapshot } from "../controllers/stateSnapshotController";

const router = Router();

router.get("/", (req, res) => {
  void getSystemStatus(req, res);
});
router.get("/history", (req, res) => {
  void listStatusSnapshots(req, res);
});
router.get("/snapshot", (req, res) => {
  void getStateSnapshot(req, res);
});

export default router;
