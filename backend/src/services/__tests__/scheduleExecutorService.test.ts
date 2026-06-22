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
jest.mock("../sequentialRunService", () => ({
  __esModule: true,
  startSequentialRun: jest.fn(),
  isRunActive: jest.fn(() => false)
}));
jest.mock("../realtimeService", () => ({ __esModule: true, emitRealtimeEvent: jest.fn() }));
jest.mock("../irrigationSettingsService", () => ({ __esModule: true, isWithinPreferredWindow: jest.fn() }));

import { buildZoneInputs } from "../scheduleExecutorService";

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
