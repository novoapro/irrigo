/**
 * Regression tests for the spurious-off debounce in the sequential-run completion path.
 *
 * Zone completion is driven by CompAI "off" webhooks. A transient off arriving within
 * seconds of a zone starting (controller echo / inUse flap) must NOT advance the run —
 * that is the "zone runs for a few instants then gets cancelled" symptom. A genuine off
 * (near/after the planned duration, or after a reasonable floor) must still advance.
 */

// sequentialRunService pulls in mongoose models and the realtime stack at import time;
// stub those so the pure helper can be imported in isolation.
jest.mock("../../models/SequentialRun", () => ({ __esModule: true, default: {} }));
jest.mock("../../models/Zone", () => ({ __esModule: true, default: {} }));
jest.mock("../irrigationCommandService", () => ({ __esModule: true, createCommand: jest.fn() }));
jest.mock("../realtimeService", () => ({ __esModule: true, emitRealtimeEvent: jest.fn() }));

import { isPrematureOff, getRemainingDurationMinutes, MIN_LEGIT_RUNTIME_MS } from "../sequentialRunService";

describe("isPrematureOff", () => {
  const start = new Date("2026-06-20T08:00:00.000Z");
  const at = (secondsAfter: number) => start.getTime() + secondsAfter * 1000;

  it("suppresses an off that arrives within seconds of a multi-minute zone start", () => {
    expect(isPrematureOff(15, start, at(5))).toBe(true);
    expect(isPrematureOff(15, start, at(29))).toBe(true);
  });

  it("honors an off at/after the legitimacy floor", () => {
    expect(isPrematureOff(15, start, at(MIN_LEGIT_RUNTIME_MS / 1000))).toBe(false);
    expect(isPrematureOff(15, start, at(120))).toBe(false);
    expect(isPrematureOff(15, start, at(15 * 60))).toBe(false);
  });

  it("trusts the off for short or unknown planned durations (no debounce below 1 minute)", () => {
    expect(isPrematureOff(0, start, at(2))).toBe(false);
    expect(isPrematureOff(undefined, start, at(2))).toBe(false);
    // exactly 1 minute planned is the smallest duration that gets debounced
    expect(isPrematureOff(1, start, at(2))).toBe(true);
  });

  it("does not suppress when startedAt is missing or the clock is skewed backwards", () => {
    expect(isPrematureOff(15, null, at(2))).toBe(false);
    expect(isPrematureOff(15, undefined, at(2))).toBe(false);
    // a "now" before startedAt (negative elapsed) is not treated as premature
    expect(isPrematureOff(15, start, start.getTime() - 5000)).toBe(false);
  });
});

describe("getRemainingDurationMinutes", () => {
  it("returns the full duration when nothing has been delivered", () => {
    expect(getRemainingDurationMinutes(10)).toBe(10);
    expect(getRemainingDurationMinutes(10, 0)).toBe(10);
    expect(getRemainingDurationMinutes(10, null)).toBe(10);
  });

  it("ceils partial minutes so the zone is never under-watered", () => {
    expect(getRemainingDurationMinutes(10, 3 * 60_000)).toBe(7);
    expect(getRemainingDurationMinutes(10, 3 * 60_000 + 1)).toBe(7); // 6m59.999s left → 7
    expect(getRemainingDurationMinutes(10, 9 * 60_000 + 30_000)).toBe(1); // 30s left → 1
  });

  it("clamps to a 1-minute floor when the accumulated time meets or exceeds the plan", () => {
    expect(getRemainingDurationMinutes(10, 10 * 60_000)).toBe(1);
    expect(getRemainingDurationMinutes(10, 25 * 60_000)).toBe(1);
  });
});
