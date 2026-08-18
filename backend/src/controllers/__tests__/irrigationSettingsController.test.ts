/**
 * Tests for the rain-prompt once-per-day gate and the clear-rain-pause endpoint.
 *
 * The rain alert must stay quiet for the rest of the calendar day (settings timezone)
 * once the user has responded — confirmed rain OR dismissed — and clear-rain-pause must
 * only clear USER-confirmed pauses, never sensor-driven ones.
 */

import type { Request, Response } from "express";

interface FakeSettings {
  rainPauseHours: number;
  timezone: string;
  lastConfirmedRainAt: Date | null;
  lastConfirmedRainIntensity: string | null;
  rainPauseClearedAt: Date | null;
  lastRainPromptRespondedAt: Date | null;
  lastRainPromptResponse: string | null;
  updatedAt: Date;
  save: jest.Mock;
}

let settingsDoc: FakeSettings;
let rainPauseState: { active: boolean; source?: string };
let precipEvent: { probability: number; periodStart: Date } | null;

const makeSettings = (overrides?: Partial<FakeSettings>): FakeSettings => ({
  rainPauseHours: 48,
  timezone: "America/New_York",
  lastConfirmedRainAt: null,
  lastConfirmedRainIntensity: null,
  rainPauseClearedAt: null,
  lastRainPromptRespondedAt: null,
  lastRainPromptResponse: null,
  updatedAt: new Date(),
  save: jest.fn(async () => {}),
  ...overrides
});

jest.mock("../../models/configs/IrrigationSettings", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(async () => settingsDoc),
    create: jest.fn(async () => settingsDoc)
  }
}));

jest.mock("../../services/irrigationSettingsService", () => {
  const actual = jest.requireActual("../../services/irrigationSettingsService");
  return {
    __esModule: true,
    getDayKeyInTimezone: actual.getDayKeyInTimezone,
    getIrrigationSettings: jest.fn(async () => settingsDoc)
  };
});

jest.mock("../../services/guardService", () => ({
  __esModule: true,
  getRainPauseState: jest.fn(async () => rainPauseState),
  cancelScheduledRunsWithinRainPause: jest.fn(async () => 0)
}));

jest.mock("../../services/realtimeService", () => ({ __esModule: true, emitRealtimeEvent: jest.fn() }));

jest.mock("../../models/PrecipitationHistory", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(() => ({ sort: () => ({ lean: async () => precipEvent }) }))
  }
}));

jest.mock("../../models/Heartbeat", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(() => ({ sort: () => ({ lean: async () => null }) }))
  }
}));

jest.mock("../../models/configs/AIScheduleConfig", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(() => ({ lean: async () => ({ preferences: { rainThresholdPercent: 40 } }) }))
  }
}));

import { getRainAlert, dismissRainAlert, clearRainPause } from "../irrigationSettingsController";
import { emitRealtimeEvent } from "../../services/realtimeService";

const makeRes = () => {
  const res: Partial<Response> & { statusCode: number; body: unknown } = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this as Response;
    },
    json(payload: unknown) {
      this.body = payload;
      return this as Response;
    }
  };
  return res as Response & { statusCode: number; body: { data?: Record<string, unknown>; message?: string } };
};

const req = {} as Request;

beforeEach(() => {
  settingsDoc = makeSettings();
  rainPauseState = { active: false };
  precipEvent = { probability: 80, periodStart: new Date(Date.now() - 3600_000) };
  (emitRealtimeEvent as jest.Mock).mockClear();
});

describe("getRainAlert once-per-day gate", () => {
  it("alerts when a qualifying forecast exists and the user has not responded", async () => {
    const res = makeRes();
    await getRainAlert(req, res);
    expect(res.body.data).toMatchObject({ alert: true, probability: 80 });
  });

  it("stays quiet for the rest of the day after the user responded", async () => {
    settingsDoc = makeSettings({ lastRainPromptRespondedAt: new Date(), lastRainPromptResponse: "dismissed" });
    const res = makeRes();
    await getRainAlert(req, res);
    expect(res.body.data).toMatchObject({ alert: false, respondedToday: true });
  });

  it("becomes eligible again the next calendar day", async () => {
    settingsDoc = makeSettings({
      lastRainPromptRespondedAt: new Date(Date.now() - 26 * 3600_000),
      lastRainPromptResponse: "dismissed"
    });
    const res = makeRes();
    await getRainAlert(req, res);
    expect(res.body.data).toMatchObject({ alert: true });
  });
});

describe("dismissRainAlert", () => {
  it("persists the response and emits a realtime event", async () => {
    const res = makeRes();
    await dismissRainAlert(req, res);

    expect(settingsDoc.lastRainPromptRespondedAt).toBeInstanceOf(Date);
    expect(settingsDoc.lastRainPromptResponse).toBe("dismissed");
    expect(settingsDoc.save).toHaveBeenCalled();
    expect(emitRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "rain:promptResponded" })
    );
    expect(res.body.data).toMatchObject({ response: "dismissed" });
  });
});

describe("clearRainPause", () => {
  it("clears a user-confirmed pause", async () => {
    settingsDoc = makeSettings({
      lastConfirmedRainAt: new Date(),
      lastConfirmedRainIntensity: "moderate"
    });
    rainPauseState = { active: true, source: "user (moderate)" };

    const res = makeRes();
    await clearRainPause(req, res);

    expect(res.statusCode).toBe(200);
    expect(settingsDoc.lastConfirmedRainAt).toBeNull();
    expect(settingsDoc.lastConfirmedRainIntensity).toBeNull();
    expect(settingsDoc.rainPauseClearedAt).toBeInstanceOf(Date);
    expect(settingsDoc.save).toHaveBeenCalled();
    expect(emitRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "rain:pauseCleared" })
    );
  });

  it("clears a sensor-detected pause by stamping the cleared-at watermark", async () => {
    rainPauseState = { active: true, source: "rain sensor" };
    const res = makeRes();
    await clearRainPause(req, res);

    expect(res.statusCode).toBe(200);
    // No confirmed-rain fields to null here — the watermark is what clears the sensor pause.
    expect(settingsDoc.rainPauseClearedAt).toBeInstanceOf(Date);
    expect(settingsDoc.save).toHaveBeenCalled();
    expect(emitRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "rain:pauseCleared" })
    );
  });

  it("rejects when no pause is active", async () => {
    rainPauseState = { active: false };
    const res = makeRes();
    await clearRainPause(req, res);
    expect(res.statusCode).toBe(409);
    expect(settingsDoc.save).not.toHaveBeenCalled();
  });
});
