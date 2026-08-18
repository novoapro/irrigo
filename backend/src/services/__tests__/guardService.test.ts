/**
 * Unit tests for getRainPauseState — the single source of truth for the rain pause.
 *
 * Intended model (see guardService.ts):
 *   - Only two inputs: the rain sensor and the user's manual report. Soil moisture is NOT
 *     a rain-pause input.
 *   - A sensor rain event is treated as a heavy rain (full window) anchored to when the
 *     sensor reported it, and persists for the whole window even after the sensor clears.
 *   - The user's report scales the window by intensity (light/moderate/heavy).
 *   - When both are active, the sensor labels the pause; the later expiry always wins.
 */

let settings: {
  rainPauseHours?: number;
  lastConfirmedRainAt?: Date | null;
  lastConfirmedRainIntensity?: string | null;
  rainPauseClearedAt?: Date | null;
};
// Value returned by Heartbeat.findOne({ "sensors.rain": true }) — the most recent
// rain-sensor detection (or null when the sensor has no rain on record).
let lastRainHeartbeat: { timestamp: Date } | null;

jest.mock("../irrigationSettingsService", () => ({
  __esModule: true,
  getIrrigationSettings: jest.fn(async () => settings)
}));

jest.mock("../../models/Heartbeat", () => ({
  __esModule: true,
  default: {
    // Honors the `timestamp: { $gt: clearedAt }` watermark filter so cleared events drop out.
    findOne: jest.fn((query?: { timestamp?: { $gt?: Date } }) => ({
      sort: () => ({
        lean: async () => {
          const gt = query?.timestamp?.$gt;
          if (gt && lastRainHeartbeat && lastRainHeartbeat.timestamp.getTime() <= gt.getTime()) {
            return null;
          }
          return lastRainHeartbeat;
        }
      })
    }))
  }
}));

jest.mock("../../models/IrrigationProgram", () => ({ __esModule: true, default: {} }));
jest.mock("../../models/ScheduleEntry", () => ({ __esModule: true, default: {} }));
jest.mock("../realtimeService", () => ({ __esModule: true, emitRealtimeEvent: jest.fn() }));

import Heartbeat from "../../models/Heartbeat";
import { getRainPauseState } from "../guardService";

const HOUR = 3600_000;
const agoHours = (h: number) => new Date(Date.now() - h * HOUR);
// A latest-heartbeat with the given connected sensors — controls which branches run.
// sensors.rain is deliberately false to prove the pause survives after rain clears.
const latestWith = (connectedSensors: string[]) =>
  ({ device: { connectedSensors }, sensors: { rain: false, soil: true } } as never);

beforeEach(() => {
  settings = {
    rainPauseHours: 48,
    lastConfirmedRainAt: null,
    lastConfirmedRainIntensity: null,
    rainPauseClearedAt: null
  };
  lastRainHeartbeat = null;
  (Heartbeat.findOne as jest.Mock).mockClear();
});

describe("getRainPauseState", () => {
  it("does not arm a pause from soil saturation (soil is not a rain input)", async () => {
    // Soil sensor connected and soil saturated, but no rain sensor detection and no user report.
    const state = await getRainPauseState(latestWith(["RAIN", "SOIL"]));
    expect(state.active).toBe(false);
    // The soil collection must never be queried for the rain pause.
    expect(Heartbeat.findOne).not.toHaveBeenCalledWith(
      expect.objectContaining({ "sensors.soil": true })
    );
  });

  it("arms a full (heavy) pause from a sensor rain event and holds it after the sensor clears", async () => {
    lastRainHeartbeat = { timestamp: agoHours(10) }; // detected 10h ago; currently rain:false
    const state = await getRainPauseState(latestWith(["RAIN"]));
    expect(state.active).toBe(true);
    expect(state.source).toBe("rain sensor");
    expect(state.triggeredAt).toBe(lastRainHeartbeat.timestamp.toISOString());
    // Heavy/full 48h window from the sensor time → ~38h remaining even though rain stopped.
    expect(state.remainingHours).toBeGreaterThan(37.5);
    expect(state.remainingHours).toBeLessThan(38.5);
  });

  it("expires a sensor pause once the full window has elapsed", async () => {
    lastRainHeartbeat = { timestamp: agoHours(49) }; // older than the 48h window
    const state = await getRainPauseState(latestWith(["RAIN"]));
    expect(state.active).toBe(false);
  });

  it("scales a user-confirmed pause by intensity (light = 0.25 → 12h window)", async () => {
    settings.lastConfirmedRainAt = agoHours(2);
    settings.lastConfirmedRainIntensity = "light";
    const state = await getRainPauseState(latestWith([])); // no rain sensor connected
    expect(state.active).toBe(true);
    expect(state.source).toBe("user (light)");
    // 48h * 0.25 = 12h window, 2h elapsed → ~10h remaining.
    expect(state.remainingHours).toBeGreaterThan(9.5);
    expect(state.remainingHours).toBeLessThan(10.5);
  });

  it("lets the sensor label the pause while keeping the user's longer window", async () => {
    // Sensor detected 47h ago (would expire in ~1h), user confirmed heavy 1h ago (~47h left).
    lastRainHeartbeat = { timestamp: agoHours(47) };
    settings.lastConfirmedRainAt = agoHours(1);
    settings.lastConfirmedRainIntensity = "heavy";
    const state = await getRainPauseState(latestWith(["RAIN"]));
    expect(state.active).toBe(true);
    // Sensor is authoritative for labelling + anchor...
    expect(state.source).toBe("rain sensor");
    expect(state.triggeredAt).toBe(lastRainHeartbeat.timestamp.toISOString());
    // ...but the pause never ends earlier than either input would (user's ~47h wins).
    expect(state.remainingHours).toBeGreaterThan(46.5);
    expect(state.remainingHours).toBeLessThan(47.5);
  });

  it("is inactive when nothing is on record", async () => {
    const state = await getRainPauseState(latestWith(["RAIN", "SOIL"]));
    expect(state.active).toBe(false);
    expect(state.source).toBeUndefined();
  });

  it("ignores a sensor rain event at or before the cleared-at watermark", async () => {
    lastRainHeartbeat = { timestamp: agoHours(2) }; // detected 2h ago
    settings.rainPauseClearedAt = agoHours(1); // user removed the pause 1h ago
    const state = await getRainPauseState(latestWith(["RAIN"]));
    expect(state.active).toBe(false);
  });

  it("ignores a user-confirmed rain at or before the cleared-at watermark", async () => {
    settings.lastConfirmedRainAt = agoHours(2);
    settings.lastConfirmedRainIntensity = "heavy";
    settings.rainPauseClearedAt = agoHours(1);
    const state = await getRainPauseState(latestWith([]));
    expect(state.active).toBe(false);
  });

  it("re-arms when a new sensor rain event lands after the watermark", async () => {
    lastRainHeartbeat = { timestamp: agoHours(1) }; // fresh detection, after the clear
    settings.rainPauseClearedAt = agoHours(2);
    const state = await getRainPauseState(latestWith(["RAIN"]));
    expect(state.active).toBe(true);
    expect(state.source).toBe("rain sensor");
  });

  it("is inactive when rainPauseHours is 0 (feature disabled)", async () => {
    settings.rainPauseHours = 0;
    lastRainHeartbeat = { timestamp: agoHours(1) };
    const state = await getRainPauseState(latestWith(["RAIN"]));
    expect(state.active).toBe(false);
  });

  it("reports windowHours matching the anchor→expiry span when active", async () => {
    lastRainHeartbeat = { timestamp: agoHours(10) };
    const state = await getRainPauseState(latestWith(["RAIN"]));
    expect(state.active).toBe(true);
    // Full sensor window is 48h from the anchor.
    expect(state.windowHours).toBeGreaterThan(47.5);
    expect(state.windowHours).toBeLessThan(48.5);
  });

  it("surfaces lastRainEventAt as context even after the window has expired", async () => {
    // Rain on record but outside the 48h window → pause inactive, event still reported.
    lastRainHeartbeat = { timestamp: agoHours(49) };
    const state = await getRainPauseState(latestWith(["RAIN"]));
    expect(state.active).toBe(false);
    expect(state.lastRainEventAt).toBe(lastRainHeartbeat.timestamp.toISOString());
  });

  it("surfaces lastRainEventAt while active alongside the pause window", async () => {
    lastRainHeartbeat = { timestamp: agoHours(3) };
    const state = await getRainPauseState(latestWith(["RAIN"]));
    expect(state.active).toBe(true);
    expect(state.lastRainEventAt).toBe(lastRainHeartbeat.timestamp.toISOString());
  });

  it("omits lastRainEventAt when there is no rain on record", async () => {
    const state = await getRainPauseState(latestWith(["RAIN", "SOIL"]));
    expect(state.active).toBe(false);
    expect(state.lastRainEventAt).toBeUndefined();
  });

  it("drops lastRainEventAt back to the user report when a sensor event is cleared by the watermark", async () => {
    // Sensor rain 2h ago is cleared; a user-confirmed rain 30m ago survives as the last event.
    lastRainHeartbeat = { timestamp: agoHours(2) };
    settings.rainPauseClearedAt = agoHours(1);
    settings.lastConfirmedRainAt = new Date(Date.now() - 30 * 60_000);
    settings.lastConfirmedRainIntensity = "moderate";
    const state = await getRainPauseState(latestWith(["RAIN"]));
    expect(state.active).toBe(true);
    expect(state.source).toBe("user (moderate)");
    expect(state.lastRainEventAt).toBe(settings.lastConfirmedRainAt!.toISOString());
  });
});
