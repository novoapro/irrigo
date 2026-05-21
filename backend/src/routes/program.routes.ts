import { Router } from "express";
import {
  listPrograms,
  getProgram,
  createProgram,
  updateProgram,
  deleteProgram,
  runProgram,
  handleCancelProgramRun
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

export default router;
