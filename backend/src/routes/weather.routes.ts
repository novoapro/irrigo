import { Router } from "express";
import { getForecast } from "../controllers/weatherController";

const router = Router();

router.get("/forecast", (req, res) => {
  void getForecast(req, res);
});

export default router;
