import { Router } from "express";
import { sendCommand, listCommands, getCommand, deleteCommands } from "../controllers/zoneControlController";
import { validateSchema } from "../middleware/validateSchema";
import { createCommandSchema } from "../schemas/irrigationCommandSchema";

const router = Router();

router.post("/:zoneId/command", validateSchema(createCommandSchema), (req, res) => {
  void sendCommand(req, res);
});

router.get("/commands", (req, res) => {
  void listCommands(req, res);
});

router.delete("/commands", (req, res) => {
  void deleteCommands(req, res);
});

router.get("/commands/:commandId", (req, res) => {
  void getCommand(req, res);
});

export default router;
