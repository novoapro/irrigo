/**
 * Regression tests for the AI program execution path.
 *
 * buildZoneInputs is the boundary where AI-generated zone durations (which, unlike
 * user-entered programs, are not constrained by the program zod schema) are turned
 * into a sequential-run plan. It must clamp each duration into [1, zoneMax] so that
 * a bad AI value cannot produce a zone that runs "a few instants" (0/negative) or one
 * that throws in createCommand (over max) and fails the whole program.
 */

const leanZones = (zones: Array<{ zoneId: string; name: string; maxDurationMinutes?: number }>) => ({
  lean: async () => zones
});

const findMock = jest.fn();

jest.mock("../../models/Zone", () => ({
  __esModule: true,
  default: { find: (...args: unknown[]) => findMock(...args) }
}));

// Avoid pulling the realtime/socket stack into the unit test.
const startSequentialRunMock = jest.fn();
jest.mock("../sequentialRunService", () => ({
  __esModule: true,
  startSequentialRun: (...args: unknown[]) => startSequentialRunMock(...args),
  isRunActive: jest.fn(() => false)
}));
jest.mock("../realtimeService", () => ({ __esModule: true, emitRealtimeEvent: jest.fn() }));

const getDeferralDeadlineMock = jest.fn();
const getWaterSavingFactorMock = jest.fn();
jest.mock("../irrigationSettingsService", () => ({
  __esModule: true,
  isWithinPreferredWindow: jest.fn(),
  getDeferralDeadline: (...args: unknown[]) => getDeferralDeadlineMock(...args),
  getWaterSavingFactor: (...args: unknown[]) => getWaterSavingFactorMock(...args)
}));

const getEffectiveGuardMock = jest.fn();
jest.mock("../guardService", () => ({
  __esModule: true,
  getEffectiveGuard: (...args: unknown[]) => getEffectiveGuardMock(...args)
}));

const getLastRunByZoneMock = jest.fn(async () => new Map<string, Date>());
const getMinutesRunTodayMock = jest.fn(async () => 0);
jest.mock("../irrigationHistoryService", () => ({
  __esModule: true,
  getLastRunByZone: (...args: unknown[]) => getLastRunByZoneMock(...(args as [])),
  getMinutesRunToday: (...args: unknown[]) => getMinutesRunTodayMock(...(args as []))
}));

// runProgram reads AIScheduleConfig.preferences for the rain gate. `aiConfigPrefs` is mutable
// so a test can inject caps (minDaysBetweenRuns / maxDailyRunMinutes) and prove the executor
// ignores them — those are planning-phase concerns, not execution gates.
let aiConfigPrefs: Record<string, unknown> = { conservativeWatering: false };
jest.mock("../../models/AIScheduleConfig", () => ({
  __esModule: true,
  default: { findOne: () => ({ lean: async () => ({ preferences: aiConfigPrefs }) }) }
}));
jest.mock("../../models/Heartbeat", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../models/WeatherForecastSnapshot", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../models/IrrigationProgram", () => ({ __esModule: true, default: {} }));
jest.mock("../../models/SystemConfig", () => ({ __esModule: true, default: {} }));

import { buildZoneInputs, runProgram } from "../scheduleExecutorService";

beforeEach(() => {
  findMock.mockReset();
});

describe("buildZoneInputs (AI duration clamping)", () => {
  it("passes through an in-range duration unchanged and resolves the zone name", async () => {
    findMock.mockReturnValue(leanZones([{ zoneId: "z1", name: "Front Lawn", maxDurationMinutes: 30 }]));

    const result = await buildZoneInputs([{ zoneId: "z1", durationMinutes: 12 }]);

    expect(result).toEqual([{ zoneId: "z1", name: "Front Lawn", durationMinutes: 12 }]);
  });

  it("clamps a zero/negative duration up to the 1-minute floor (prevents 'few instants' runs)", async () => {
    findMock.mockReturnValue(leanZones([{ zoneId: "z1", name: "Z1", maxDurationMinutes: 30 }]));

    const result = await buildZoneInputs([
      { zoneId: "z1", durationMinutes: 0 }
    ]);

    expect(result[0]!.durationMinutes).toBe(1);
  });

  it("clamps a duration above the zone max down to the max (prevents createCommand from throwing)", async () => {
    findMock.mockReturnValue(leanZones([{ zoneId: "z1", name: "Z1", maxDurationMinutes: 20 }]));

    const result = await buildZoneInputs([{ zoneId: "z1", durationMinutes: 999 }]);

    expect(result[0]!.durationMinutes).toBe(20);
  });

  it("falls back to a 60-minute max and rounds fractional durations", async () => {
    findMock.mockReturnValue(leanZones([{ zoneId: "z1", name: "Z1" }]));

    const [over, frac] = await Promise.all([
      buildZoneInputs([{ zoneId: "z1", durationMinutes: 75 }]),
      buildZoneInputs([{ zoneId: "z1", durationMinutes: 9.6 }])
    ]);

    expect(over[0]!.durationMinutes).toBe(60);
    expect(frac[0]!.durationMinutes).toBe(10);
  });

  it("skips a zone the AI invented (unknown zoneId) instead of failing the run", async () => {
    // Only "laterals" exists; the AI also asked for a non-existent "lateral".
    findMock.mockReturnValue(leanZones([{ zoneId: "laterals", name: "Lateral", maxDurationMinutes: 20 }]));

    const result = await buildZoneInputs([
      { zoneId: "lateral", durationMinutes: 8 },
      { zoneId: "laterals", durationMinutes: 8 }
    ]);

    expect(result).toEqual([{ zoneId: "laterals", name: "Lateral", durationMinutes: 8 }]);
  });

  it("treats NaN/non-finite durations as the 1-minute floor", async () => {
    findMock.mockReturnValue(leanZones([{ zoneId: "z1", name: "Z1", maxDurationMinutes: 30 }]));

    const result = await buildZoneInputs([
      { zoneId: "z1", durationMinutes: Number.NaN as unknown as number }
    ]);

    expect(result[0]!.durationMinutes).toBe(1);
  });
});

// Reproduces a Mongoose embedded subdocument: schema paths live behind prototype getters
// and are NOT own-enumerable, so `{ ...subdoc }` copies Mongoose internals (_doc, $__) and
// drops zoneId. In checkDuePrograms the program is a hydrated doc, so its zoneEntries are
// exactly these subdocuments — the bug that made runProgram skip every scheduled program.
const fakeSubdoc = (zoneId: string, durationMinutes: number) => {
  const proto = {};
  Object.defineProperty(proto, "zoneId", { get(this: { _doc: { zoneId: string } }) { return this._doc.zoneId; } });
  Object.defineProperty(proto, "durationMinutes", { get(this: { _doc: { durationMinutes: number } }) { return this._doc.durationMinutes; } });
  const obj = Object.create(proto) as Record<string, unknown>;
  obj._doc = { zoneId, durationMinutes }; // own-enumerable — what the spread would copy
  obj.$__ = {}; // own-enumerable mongoose internal
  return obj;
};

describe("runProgram (hydrated program with subdocument zoneEntries)", () => {
  beforeEach(() => {
    startSequentialRunMock.mockReset().mockResolvedValue("run-1");
    getEffectiveGuardMock.mockReset().mockResolvedValue({ rainPause: { active: false }, hardware: false, reason: null });
    getDeferralDeadlineMock.mockReset().mockResolvedValue(new Date(Date.now() + 6 * 3600_000));
    getWaterSavingFactorMock.mockReset().mockResolvedValue(1);
    getLastRunByZoneMock.mockReset().mockResolvedValue(new Map<string, Date>());
    getMinutesRunTodayMock.mockReset().mockResolvedValue(0);
    aiConfigPrefs = { conservativeWatering: false };
  });

  const makeProgram = (zoneEntries: unknown[]) => ({
    programId: "p1",
    name: "Overnight Irrigation",
    source: "ai-schedule",
    status: "planned",
    enabled: true,
    plannedStartAt: new Date(),
    zoneEntries,
    save: jest.fn(async () => undefined),
    toObject: () => ({})
  });

  it("preserves zoneId from subdocuments and starts the run (regression: 'No runnable zones')", async () => {
    findMock.mockReturnValue(
      leanZones([
        { zoneId: "front", name: "Front", maxDurationMinutes: 30 },
        { zoneId: "back", name: "Back", maxDurationMinutes: 60 }
      ])
    );
    const program = makeProgram([fakeSubdoc("front", 20), fakeSubdoc("back", 20)]);

    await runProgram(program as never);

    expect(program.status).toBe("executing");
    expect(startSequentialRunMock).toHaveBeenCalledTimes(1);
    const inputs = startSequentialRunMock.mock.calls[0]![0] as Array<{ zoneId: string; durationMinutes: number }>;
    expect(inputs.map((i) => i.zoneId)).toEqual(["front", "back"]);
  });

  it("applies the water-saving factor while still preserving zoneId from subdocuments", async () => {
    getWaterSavingFactorMock.mockResolvedValue(0.5);
    findMock.mockReturnValue(leanZones([{ zoneId: "front", name: "Front", maxDurationMinutes: 30 }]));
    const program = makeProgram([fakeSubdoc("front", 20)]);

    await runProgram(program as never);

    expect(startSequentialRunMock).toHaveBeenCalledTimes(1);
    const inputs = startSequentialRunMock.mock.calls[0]![0] as Array<{ zoneId: string; durationMinutes: number }>;
    expect(inputs).toEqual([{ zoneId: "front", name: "Front", durationMinutes: 10 }]);
  });

  // Policy caps are planning-phase concerns, not execution gates. A scheduled program must
  // run even when its zone ran within minDaysBetweenRuns and the day is already over the daily
  // cap — the AI planner (or a user force-creating a program) already made that call. If anyone
  // reinstates these gates in runProgram, this test fails.
  it("runs a scheduled program even when min-rest and daily caps would be exceeded", async () => {
    aiConfigPrefs = { conservativeWatering: false, minDaysBetweenRuns: 2, maxDailyRunMinutes: 1 };
    getLastRunByZoneMock.mockResolvedValue(new Map([["front", new Date(Date.now() - 60_000)]])); // ran 1 min ago
    getMinutesRunTodayMock.mockResolvedValue(999); // already way over the 1-minute daily cap
    findMock.mockReturnValue(leanZones([{ zoneId: "front", name: "Front", maxDurationMinutes: 30 }]));
    const program = makeProgram([fakeSubdoc("front", 2)]);

    await runProgram(program as never);

    expect(program.status).toBe("executing");
    expect(startSequentialRunMock).toHaveBeenCalledTimes(1);
    const inputs = startSequentialRunMock.mock.calls[0]![0] as Array<{ zoneId: string; durationMinutes: number }>;
    expect(inputs).toEqual([{ zoneId: "front", name: "Front", durationMinutes: 2 }]);
  });

  it("still blocks on a real-time condition — rain pause — even though caps are ignored", async () => {
    getEffectiveGuardMock.mockResolvedValue({ rainPause: { active: true }, hardware: false, reason: "Rain pause active (rain sensor)" });
    findMock.mockReturnValue(leanZones([{ zoneId: "front", name: "Front", maxDurationMinutes: 30 }]));
    const program = makeProgram([fakeSubdoc("front", 2)]);

    await runProgram(program as never);

    expect(program.status).toBe("skipped");
    expect(startSequentialRunMock).not.toHaveBeenCalled();
  });
});
