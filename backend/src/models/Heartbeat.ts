import { Schema, model } from "mongoose";
import { HEARTBEAT_RETENTION_SECONDS } from "../config/persistence";

/**
 * A tracked reading paired with `since`: the timestamp at which the reading last
 * *changed* to its current value. On ingest we carry `since` forward while the value
 * is unchanged and reset it to "now" when it flips, so the latest heartbeat alone
 * answers "when did this last change?" — no scan across history required. `TrackedBool`
 * covers the on/off signals (guard, rain, soil); `TrackedNumber` covers waterPsi.
 */
export interface TrackedBool {
  triggered: boolean;
  since: Date;
}

export interface TrackedNumber {
  value: number;
  since: Date;
}

export interface HeartbeatAttributes {
  timestamp: Date;
  guard: TrackedBool;
  sensors: {
    waterPsi: TrackedNumber;
    rain: TrackedBool;
    soil: TrackedBool;
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
    triggered: { type: Boolean, required: true },
    since: { type: Date, required: true }
  },
  sensors: {
    waterPsi: {
      value: { type: Number, required: true, min: 0 },
      since: { type: Date, required: true }
    },
    rain: {
      triggered: { type: Boolean, required: true },
      since: { type: Date, required: true }
    },
    soil: {
      triggered: { type: Boolean, required: true },
      since: { type: Date, required: true }
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
