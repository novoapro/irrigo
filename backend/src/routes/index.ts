import { Router } from "express";
import heartbeatRouter from "./heartbeat.routes";
import statusRouter from "./status.routes";
import weatherRouter from "./weather.routes";
import deviceRouter from "./device.routes";
import irrigationRouter from "./irrigation.routes";

const router = Router();
router.use("/heartbeats", heartbeatRouter);
router.use("/status", statusRouter);
router.use("/weather", weatherRouter);
router.use("/device", deviceRouter);
router.use("/irrigation", irrigationRouter);

export default router;
