import { Router } from "express";
import {
  getAIScheduleConfig,
  upsertAIScheduleConfig,
  triggerScheduleRun,
  listScheduleRuns,
  getScheduleRun,
  listScheduleEntries,
  getUpcomingEntries,
  cancelEntry,
  deferEntry,
  materializeProgramEntries,
  getMaterializedProgramEntries,
  skipEntry
} from "../controllers/aiScheduleController";
import { validateSchema } from "../middleware/validateSchema";
import { aiScheduleConfigSchema } from "../schemas/aiScheduleConfigSchema";

const router = Router();

router.get("/config", (req, res) => {
  void getAIScheduleConfig(req, res);
});

router.put("/config", validateSchema(aiScheduleConfigSchema), (req, res) => {
  void upsertAIScheduleConfig(req, res);
});

router.post("/run", (req, res) => {
  void triggerScheduleRun(req, res);
});

router.get("/runs", (req, res) => {
  void listScheduleRuns(req, res);
});

router.get("/runs/:runId", (req, res) => {
  void getScheduleRun(req, res);
});

router.get("/entries", (req, res) => {
  void listScheduleEntries(req, res);
});

router.get("/entries/upcoming", (req, res) => {
  void getUpcomingEntries(req, res);
});

router.patch("/entries/:id/cancel", (req, res) => {
  void cancelEntry(req, res);
});

router.get("/entries/program", (req, res) => {
  void getMaterializedProgramEntries(req, res);
});

router.post("/entries/materialize", (req, res) => {
  void materializeProgramEntries(req, res);
});

router.patch("/entries/:id/defer", (req, res) => {
  void deferEntry(req, res);
});

router.patch("/entries/:id/skip", (req, res) => {
  void skipEntry(req, res);
});

export default router;
