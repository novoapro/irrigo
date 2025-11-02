import { Request, Response } from "express";
import {
  ensureForecastSnapshot,
  buildWeatherOverview
} from "../services/weatherForecastService";

const parseDateQuery = (value: unknown): Date | undefined => {
  if (!value || typeof value !== "string") {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

export const getForecast = async (req: Request, res: Response) => {
  try {
    const start = parseDateQuery(req.query.start);
    const end = parseDateQuery(req.query.end);

    if (req.query.start && typeof req.query.start === "string" && !start) {
      console.warn("[API] getForecast - invalid 'start' query", {
        method: req.method,
        url: req.originalUrl,
        start: req.query.start
      });
    }
    if (req.query.end && typeof req.query.end === "string" && !end) {
      console.warn("[API] getForecast - invalid 'end' query", {
        method: req.method,
        url: req.originalUrl,
        end: req.query.end
      });
    }

    const snapshot = await ensureForecastSnapshot();
    const payload = await buildWeatherOverview(snapshot, start, end);

    res.json({ data: payload });
  } catch (error) {
    console.error("Failed to retrieve forecast:", error);
    res.status(500).json({ message: "Unable to fetch forecast" });
  }
};
