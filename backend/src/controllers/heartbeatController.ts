import { Request, Response } from "express";
import type { HeartbeatInput } from "../schemas/heartbeatSchema";
import Heartbeat from "../models/Heartbeat";
import { relayGuardState } from "../services/guardRelayService";
import { getCurrentWeatherConditions } from "../services/weatherForecastService";
import { buildHeartbeatOverview } from "../services/heartbeatAnalyticsService";
import { emitRealtimeEvent } from "../services/realtimeService";
import { statusCache } from "./statusController";

const MAX_LIST_LIMIT = 500;

export const createHeartbeat = async (req: Request, res: Response) => {
  const payload = req.validatedBody as HeartbeatInput | undefined;

  if (!payload) {
    console.warn("[API] createHeartbeat - invalid/missing payload", {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip
    });
    return res.status(500).json({
      message: "Heartbeat payload was not validated. Is validateSchema middleware configured?"
    });
  }

  try {
    let weatherSnapshot = null;
    try {
      weatherSnapshot = await getCurrentWeatherConditions();
    } catch (weatherError) {
      console.error("Failed to attach weather snapshot to heartbeat:", weatherError);
    }

    const heartbeat = await Heartbeat.create({
      guard: payload.guard,
      sensors: {
        waterPsi: payload.sensors.waterPsi,
        rain: payload.sensors.rain,
        soil: payload.sensors.soil
      },
      device: {
        ip: payload.device.ip,
        tempF: payload.device.tempF,
        humidity: payload.device.humidity,
        baselinePsi: payload.device.baselinePsi,
        connectedSensors: payload.device.connectedSensors ?? [
          "PRESSURE",
          "RAIN",
          "SOIL"
        ]
      },
      weather: weatherSnapshot ?? null,
      timestamp: new Date() // use server time, ignore client timestamp
    });

    void relayGuardState(heartbeat.guard);

    emitRealtimeEvent({
      type: "heartbeat:new",
      payload: heartbeat.toObject()
    });
    res.status(201).json({ 
      message: "Heartbeat recorded successfully" 
    });
    statusCache.payload = null;
    statusCache.heartbeatId = null;
  } catch (error) {
    console.error("Failed to store heartbeat:", error);
    res.status(500).json({ message: "Unable to store heartbeat" });
  }
};

export const listHeartbeats = async (req: Request, res: Response) => {
  const { start, end } = req.query;

  const filter: Record<string, unknown> = {};
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (typeof start === "string" && start.length > 0) {
    const parsed = new Date(start);
    if (Number.isNaN(parsed.valueOf())) {
      console.warn("[API] listHeartbeats - invalid 'start' query", {
        method: req.method,
        url: req.originalUrl,
        start
      });
      return res.status(400).json({ message: "start must be a valid date string" });
    }
    startDate = parsed;
  }

  if (typeof end === "string" && end.length > 0) {
    const parsed = new Date(end);
    if (Number.isNaN(parsed.valueOf())) {
      console.warn("[API] listHeartbeats - invalid 'end' query", {
        method: req.method,
        url: req.originalUrl,
        end
      });
      return res.status(400).json({ message: "end must be a valid date string" });
    }
    endDate = parsed;
  }

  if (startDate && endDate && startDate > endDate) {
    console.warn("[API] listHeartbeats - 'start' is after 'end'", {
      method: req.method,
      url: req.originalUrl,
      start: startDate,
      end: endDate
    });
    return res.status(400).json({ message: "start must be before end" });
  }

  if (startDate || endDate) {
    const timestampFilter: Record<string, Date> = {};
    if (startDate) {
      timestampFilter.$gte = startDate;
    }
    if (endDate) {
      timestampFilter.$lte = endDate;
    }
    filter.timestamp = timestampFilter;
  }

  const pageCandidate = Number.parseInt((req.query.page as string) ?? "", 10);
  const page = Number.isInteger(pageCandidate) && pageCandidate > 0 ? pageCandidate : 1;

  const pageSizeCandidate = Number.parseInt((req.query.pageSize as string) ?? "", 10);
  const pageSize =
    Number.isInteger(pageSizeCandidate) && pageSizeCandidate > 0
      ? Math.min(pageSizeCandidate, MAX_LIST_LIMIT)
      : 25;

  const skip = (page - 1) * pageSize;

  try {
    const [totalCount, heartbeats] = await Promise.all([
      Heartbeat.countDocuments(filter),
      Heartbeat.find(filter)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    res.json({
      data: heartbeats,
      meta: {
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    console.error("Failed to list heartbeats:", error);
    res.status(500).json({ message: "Unable to fetch heartbeats" });
  }
};

export const listHeartbeatSeries = async (req: Request, res: Response) => {
  const { start, end, limit: limitQuery } = req.query;

  const filter: Record<string, unknown> = {};
  if (start || end) {
    const timestampFilter: Record<string, Date> = {};
    if (typeof start === "string" && start.length > 0) {
      const parsedStart = new Date(start);
      if (Number.isNaN(parsedStart.valueOf())) {
        console.warn("[API] listHeartbeatSeries - invalid 'start' query", {
          method: req.method,
          url: req.originalUrl,
          start
        });
        return res.status(400).json({ message: "start must be a valid date string" });
      }
      timestampFilter.$gte = parsedStart;
    }
    if (typeof end === "string" && end.length > 0) {
      const parsedEnd = new Date(end);
      if (Number.isNaN(parsedEnd.valueOf())) {
        console.warn("[API] listHeartbeatSeries - invalid 'end' query", {
          method: req.method,
          url: req.originalUrl,
          end
        });
        return res.status(400).json({ message: "end must be a valid date string" });
      }
      timestampFilter.$lte = parsedEnd;
    }
    filter.timestamp = timestampFilter;
  }

  const limitCandidate = Number.parseInt((limitQuery as string) ?? "", 10);
  const limit =
    Number.isInteger(limitCandidate) && limitCandidate > 0
      ? Math.min(limitCandidate, MAX_LIST_LIMIT)
      : 200;

  try {
    const heartbeats = await Heartbeat.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .select({
        timestamp: 1,
        "sensors.waterPsi": 1
      })
      .lean();

    const series = heartbeats
      .map((entry) => {
        const psi = Number(entry.sensors?.waterPsi ?? NaN);
        const timestamp =
          entry.timestamp instanceof Date
            ? entry.timestamp.toISOString()
            : new Date(entry.timestamp).toISOString();
        if (Number.isNaN(psi)) {
          return null;
        }
        return {
          timestamp,
          psi
        };
      })
      .filter(
        (entry): entry is { timestamp: string; psi: number } =>
          entry !== null
      )
      .reverse();

    res.json({ data: series });
  } catch (error) {
    console.error("Failed to list heartbeat series:", error);
    res.status(500).json({ message: "Unable to fetch heartbeat series" });
  }
};

export const getHeartbeatOverview = async (req: Request, res: Response) => {
  const { start, end } = req.query;

  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (typeof start === "string" && start.length > 0) {
    const parsedStart = new Date(start);
    if (Number.isNaN(parsedStart.valueOf())) {
      console.warn("[API] getHeartbeatOverview - invalid 'start' query", {
        method: req.method,
        url: req.originalUrl,
        start
      });
      return res.status(400).json({ message: "start must be a valid date string" });
    }
    startDate = parsedStart;
  }

  if (typeof end === "string" && end.length > 0) {
    const parsedEnd = new Date(end);
    if (Number.isNaN(parsedEnd.valueOf())) {
      console.warn("[API] getHeartbeatOverview - invalid 'end' query", {
        method: req.method,
        url: req.originalUrl,
        end
      });
      return res.status(400).json({ message: "end must be a valid date string" });
    }
    endDate = parsedEnd;
  }

  if (startDate && endDate && startDate > endDate) {
    console.warn("[API] getHeartbeatOverview - 'start' is after 'end'", {
      method: req.method,
      url: req.originalUrl,
      start: startDate,
      end: endDate
    });
    return res.status(400).json({ message: "start must be before end" });
  }

  const filter: Record<string, unknown> = {};
  if (startDate || endDate) {
    const timestampFilter: Record<string, Date> = {};
    if (startDate) {
      timestampFilter.$gte = startDate;
    }
    if (endDate) {
      timestampFilter.$lte = endDate;
    }
    filter.timestamp = timestampFilter;
  }

  try {
    const heartbeats = await Heartbeat.find(filter)
      .sort({ timestamp: 1 })
      .lean();

    const overview = buildHeartbeatOverview(
      heartbeats,
      startDate,
      endDate
    );

    res.json({ data: overview });
  } catch (error) {
    console.error("Failed to build heartbeat overview:", error);
    res.status(500).json({ message: "Unable to build heartbeat overview" });
  }
};
