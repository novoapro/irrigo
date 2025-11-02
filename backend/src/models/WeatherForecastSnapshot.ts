import { Schema, model } from "mongoose";

export interface WeatherForecastSnapshotAttributes {
  office: string;
  gridX: number;
  gridY: number;
  locationName: string;
  fetchedAt: Date;
  expiresAt: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  temperature: number | null;
  temperatureUnit: string | null;
  precipitationProbability: number | null;
  createdAt?: Date;
  isDaytime?: boolean | null;
  shortForecast?: string | null;
  periods?: ForecastPeriodSnapshot[];
}

export interface ForecastPeriodSnapshot {
  startTime: Date;
  endTime: Date;
  temperature: number | null;
  temperatureUnit: string | null;
  isDaytime: boolean | null;
  precipitationProbability: number | null;
  shortForecast: string | null;
}

const forecastPeriodSchema = new Schema<ForecastPeriodSnapshot>(
  {
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    temperature: { type: Number, default: null },
    temperatureUnit: { type: String, default: null },
    isDaytime: { type: Boolean, default: null },
    precipitationProbability: { type: Number, default: null },
    shortForecast: { type: String, default: null }
  },
  { _id: false }
);

const weatherForecastSnapshotSchema =
  new Schema<WeatherForecastSnapshotAttributes>({
    office: { type: String, required: true },
    gridX: { type: Number, required: true },
    gridY: { type: Number, required: true },
    locationName: { type: String, required: true },
    fetchedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    temperature: { type: Number, default: null },
    temperatureUnit: { type: String, default: null },
    precipitationProbability: { type: Number, default: null },
    isDaytime: { type: Boolean, default: null },
    shortForecast: { type: String, default: null },
    periods: { type: [forecastPeriodSchema], default: [] }
  });

const WeatherForecastSnapshot = model<WeatherForecastSnapshotAttributes>(
  "WeatherForecastSnapshot",
  weatherForecastSnapshotSchema
);

export default WeatherForecastSnapshot;
