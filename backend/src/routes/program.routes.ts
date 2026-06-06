import { Router } from "express";
import {
  listPrograms,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  runProgram,
  handleCancelProgramRun,
  cancelAIProgram,
  skipAIProgram,
  deferAIProgram
} from "../controllers/programController";
import { validateSchema } from "../middleware/validateSchema";
import { createProgramSchema, updateProgramSchema } from "../schemas/irrigationProgramSchema";

const router = Router();

router.get("/", (req, res) => {
  void listPrograms(req, res);
});

router.post("/cancel-run", (req, res) => {
  void handleCancelProgramRun(req, res);
});

router.post("/", validateSchema(createProgramSchema), (req, res) => {
  void createProgram(req, res);
});

router.get("/:programId", (req, res) => {
  void getProgram(req, res);
});

router.put("/:programId", validateSchema(updateProgramSchema), (req, res) => {
  void updateProgram(req, res);
});

router.delete("/:programId", (req, res) => {
  void deleteProgram(req, res);
});

router.post("/:programId/run", (req, res) => {
  void runProgram(req, res);
});

router.post("/:programId/cancel", (req, res) => {
  void cancelAIProgram(req, res);
});

router.post("/:programId/skip", (req, res) => {
  void skipAIProgram(req, res);
});

router.post("/:programId/defer", (req, res) => {
  void deferAIProgram(req, res);
});

export default router;
