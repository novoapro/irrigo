import { Router } from "express";
import { getSystemStatus, listStatusSnapshots } from "../controllers/statusController";

const router = Router();

router.get("/", (req, res) => {
  void getSystemStatus(req, res);
});
router.get("/history", (req, res) => {
  void listStatusSnapshots(req, res);
});

export default router;
