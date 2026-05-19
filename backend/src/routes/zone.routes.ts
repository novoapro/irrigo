import { Router } from "express";
import {
  listZones,
  getZone,
  createZone,
  updateZone,
  deleteZone,
  toggleZone,
  reorderZones,
  getZoneState,
  getAllZoneStates
} from "../controllers/zoneController";
import { validateSchema } from "../middleware/validateSchema";
import { createZoneSchema, updateZoneSchema, reorderZonesSchema } from "../schemas/zoneSchema";

const router = Router();

router.get("/", (req, res) => {
  void listZones(req, res);
});

router.get("/states", (req, res) => {
  void getAllZoneStates(req, res);
});

router.get("/:zoneId", (req, res) => {
  void getZone(req, res);
});

router.get("/:zoneId/state", (req, res) => {
  void getZoneState(req, res);
});

router.post("/", validateSchema(createZoneSchema), (req, res) => {
  void createZone(req, res);
});

router.put("/reorder", validateSchema(reorderZonesSchema), (req, res) => {
  void reorderZones(req, res);
});

router.put("/:zoneId", validateSchema(updateZoneSchema), (req, res) => {
  void updateZone(req, res);
});

router.delete("/:zoneId", (req, res) => {
  void deleteZone(req, res);
});

router.patch("/:zoneId/toggle", (req, res) => {
  void toggleZone(req, res);
});

export default router;
