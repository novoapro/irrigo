import { Schema, model } from "mongoose";
import { HEARTBEAT_RETENTION_SECONDS } from "../config/persistence";

export interface HeartbeatAttributes {
  timestamp: Date;
  guard: boolean;
  sensors: {
    waterPsi: number;
    rain: boolean;
    soil: boolean;
  };
  device: {
    ip: string;
    tempF: number;
    humidity: number;
    baselinePsi: number;
    connectedSensors: Array<"PRESSURE" | "RAIN" | "SOIL">;
  };
  weather?: HeartbeatWeatherSnapshot | null;
}

export interface HeartbeatWeatherSnapshot {
  locationName: string;
  fetchedAt: Date;
  expiresAt: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  temperature: number | null;
  temperatureUnit: string | null;
  precipitationProbability: number | null;
  isDaytime?: boolean | null;
  shortForecast?: string | null;
}

const heartbeatWeatherSchema = new Schema<HeartbeatWeatherSnapshot>(
  {
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
  },
  { _id: false }
);

const heartbeatSchema = new Schema<HeartbeatAttributes>({
  timestamp: {
    type: Date,
    default: () => new Date()
  },
  guard: {
    type: Boolean,
    required: true
  },
  sensors: {
    waterPsi: {
      type: Number,
      required: true,
      min: 0
    },
    rain: {
      type: Boolean,
      required: true
    },
    soil: {
      type: Boolean,
      required: true
    }
  },
  device: {
    ip: {
      type: String,
      required: true
    },
    tempF: {
      type: Number,
      required: true
    },
    humidity: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    baselinePsi: {
      type: Number,
      required: true,
      min: 0
    },
    connectedSensors: {
      type: [String],
      enum: ["PRESSURE", "RAIN", "SOIL"],
      default: ["PRESSURE", "RAIN", "SOIL"]
    }
  },
  weather: { type: heartbeatWeatherSchema, default: null }
});

heartbeatSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: HEARTBEAT_RETENTION_SECONDS, name: "heartbeat_ttl" }
);

const Heartbeat = model<HeartbeatAttributes>("Heartbeat", heartbeatSchema);

export default Heartbeat;
