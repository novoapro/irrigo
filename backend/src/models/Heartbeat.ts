import { Schema, model } from "mongoose";
import { HEARTBEAT_RETENTION_SECONDS } from "../config/persistence";

/**
 * An on/off reading paired with `since`: the timestamp at which it last *changed* to its
 * current value. On ingest we carry `since` forward while the value is unchanged and reset
 * it to "now" when it flips, so the latest heartbeat alone answers "when did this last
 * change?" — no scan across history required. Used only for `rain` and `soil`, whose onset
 * has real meaning (a rain pause anchors to when rain *began*). `guard` and `waterPsi` are
 * plain readings: guard is a simple flag, and waterPsi is a jittery analog value whose
 * "since" would reset almost every heartbeat, so neither earns the extra shape.
 */
export interface TrackedBool {
  triggered: boolean;
  since: Date;
}

export interface HeartbeatAttributes {
  timestamp: Date;
  guard: boolean;
  sensors: {
    waterPsi: number;
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
