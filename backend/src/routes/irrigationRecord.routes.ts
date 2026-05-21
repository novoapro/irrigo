import { Router } from "express";
import { listIrrigationRecords, latestPerZone } from "../controllers/irrigationRecordController";

const router = Router();

router.get("/latest-per-zone", (req, res) => {
  void latestPerZone(req, res);
});

router.get("/", (req, res) => {
  void listIrrigationRecords(req, res);
});

export default router;
