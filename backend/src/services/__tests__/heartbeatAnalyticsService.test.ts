import { buildHeartbeatOverview } from "../heartbeatAnalyticsService";
import type { HeartbeatAttributes } from "../../models/Heartbeat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSample = (
  timestamp: Date,
  guard: boolean,
  waterPsi: number,
  baselinePsi: number,
  rain = false,
  soil = false
): HeartbeatAttributes => ({
  timestamp,
  guard,
  sensors: { waterPsi, rain, soil },
  device: {
    ip: "192.168.1.100",
    tempF: 72,
    humidity: 55,
    baselinePsi,
    connectedSensors: ["PRESSURE", "RAIN", "SOIL"]
  }
});

const T0 = new Date("2025-01-01T00:00:00.000Z");
const T1 = new Date("2025-01-01T01:00:00.000Z"); // T0 + 1 h
const T2 = new Date("2025-01-01T02:00:00.000Z"); // T0 + 2 h
const T3 = new Date("2025-01-01T03:00:00.000Z"); // T0 + 3 h
const ONE_HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildHeartbeatOverview", () => {
  // ── Empty input ───────────────────────────────────────────────────────────
  describe("empty samples", () => {
    it("returns all-zero counters", () => {
      const result = buildHeartbeatOverview([]);
      expect(result.guard.activeMs).toBe(0);
      expect(result.guard.inactiveMs).toBe(0);
      expect(result.pressure.activeMs).toBe(0);
      expect(result.pressure.inactiveMs).toBe(0);
      expect(result.rainDays.positive).toBe(0);
      expect(result.rainDays.negative).toBe(0);
      expect(result.soilDays.positive).toBe(0);
      expect(result.soilDays.negative).toBe(0);
    });

    it("returns null range start (no data to anchor it)", () => {
      const result = buildHeartbeatOverview([]);
      expect(result.range.start).toBeNull();
    });

    it("returns a non-null range end (defaults to current time when no data)", () => {
      // effectiveEnd = rangeEnd ?? new Date() — with no samples and no explicit
      // rangeEnd the implementation defaults to now rather than null.
      const result = buildHeartbeatOverview([]);
      expect(result.range.end).not.toBeNull();
    });
  });

  // ── Guard time accumulation ───────────────────────────────────────────────
  describe("guard time accumulation", () => {
    it("attributes the full range to activeMs when guard is always on", () => {
      const samples = [
        makeSample(T0, true, 30, 20),
        makeSample(T1, true, 30, 20)
      ];
      const result = buildHeartbeatOverview(samples, T0, T2);
      expect(result.guard.activeMs).toBe(2 * ONE_HOUR_MS);
      expect(result.guard.inactiveMs).toBe(0);
    });

    it("attributes the full range to inactiveMs when guard is always off", () => {
      const samples = [
        makeSample(T0, false, 30, 20),
        makeSample(T1, false, 30, 20)
      ];
      const result = buildHeartbeatOverview(samples, T0, T2);
      expect(result.guard.activeMs).toBe(0);
      expect(result.guard.inactiveMs).toBe(2 * ONE_HOUR_MS);
    });

    it("splits time correctly when guard switches once mid-range", () => {
      // guard on during [T0, T1), off during [T1, T2)
      const samples = [
        makeSample(T0, true, 30, 20),
        makeSample(T1, false, 30, 20)
      ];
      const result = buildHeartbeatOverview(samples, T0, T2);
      expect(result.guard.activeMs).toBe(ONE_HOUR_MS);
      expect(result.guard.inactiveMs).toBe(ONE_HOUR_MS);
    });

    it("handles multiple guard transitions across a 3-hour range", () => {
      // on [T0,T1), off [T1,T2), on [T2,T3)
      const samples = [
        makeSample(T0, true, 30, 20),
        makeSample(T1, false, 30, 20),
        makeSample(T2, true, 30, 20)
      ];
      const result = buildHeartbeatOverview(samples, T0, T3);
      expect(result.guard.activeMs).toBe(2 * ONE_HOUR_MS);
      expect(result.guard.inactiveMs).toBe(ONE_HOUR_MS);
    });
  });

  // ── Pressure accumulation ─────────────────────────────────────────────────
  describe("pressure accumulation", () => {
    it("counts time above baseline as activeMs", () => {
      // waterPsi 35 > baselinePsi 20
      const samples = [
        makeSample(T0, false, 35, 20),
        makeSample(T1, false, 35, 20)
      ];
      const result = buildHeartbeatOverview(samples, T0, T2);
      expect(result.pressure.activeMs).toBe(2 * ONE_HOUR_MS);
      expect(result.pressure.inactiveMs).toBe(0);
    });

    it("counts time at or below baseline as inactiveMs", () => {
      // waterPsi 15 < baselinePsi 20
      const samples = [
        makeSample(T0, false, 15, 20),
        makeSample(T1, false, 15, 20)
      ];
      const result = buildHeartbeatOverview(samples, T0, T2);
      expect(result.pressure.activeMs).toBe(0);
      expect(result.pressure.inactiveMs).toBe(2 * ONE_HOUR_MS);
    });

    it("correctly splits pressure time when it crosses baseline mid-range", () => {
      const samples = [
        makeSample(T0, false, 25, 20), // above for first hour
        makeSample(T1, false, 10, 20)  // below for second hour
      ];
      const result = buildHeartbeatOverview(samples, T0, T2);
      expect(result.pressure.activeMs).toBe(ONE_HOUR_MS);
      expect(result.pressure.inactiveMs).toBe(ONE_HOUR_MS);
    });
  });

  // ── Rain and soil day counting ─────────────────────────────────────────────
  describe("rain and soil day counting", () => {
    it("counts a day as rainy when any sample on that day has rain=true", () => {
      const day1 = new Date("2025-06-01T10:00:00.000Z");
      const day2 = new Date("2025-06-02T10:00:00.000Z");
      const samples = [
        makeSample(day1, false, 20, 20, true,  false),
        makeSample(day2, false, 20, 20, false, false)
      ];
      const result = buildHeartbeatOverview(samples);
      expect(result.rainDays.positive).toBe(1); // 1 rainy day
      expect(result.rainDays.negative).toBe(1); // 1 dry day
    });

    it("counts a day as moist when any sample on that day has soil=true", () => {
      const day1 = new Date("2025-06-01T10:00:00.000Z");
      const day2 = new Date("2025-06-02T10:00:00.000Z");
      const samples = [
        makeSample(day1, false, 20, 20, false, true),
        makeSample(day2, false, 20, 20, false, false)
      ];
      const result = buildHeartbeatOverview(samples);
      expect(result.soilDays.positive).toBe(1);
      expect(result.soilDays.negative).toBe(1);
    });

    it("deduplicates multiple samples on the same day into a single day entry", () => {
      const morning = new Date("2025-06-01T08:00:00.000Z");
      const evening = new Date("2025-06-01T20:00:00.000Z");
      const samples = [
        makeSample(morning, false, 20, 20, false, false),
        makeSample(evening, false, 20, 20, true,  true) // rain/soil detected later same day
      ];
      const result = buildHeartbeatOverview(samples);
      // Should count as ONE day total, with positive flags from the evening sample
      expect(result.rainDays.positive).toBe(1);
      expect(result.rainDays.negative).toBe(0);
      expect(result.soilDays.positive).toBe(1);
      expect(result.soilDays.negative).toBe(0);
    });

    it("counts both positive and negative across multiple days correctly", () => {
      const samples = [
        makeSample(new Date("2025-06-01T12:00:00.000Z"), false, 20, 20, true,  true),
        makeSample(new Date("2025-06-02T12:00:00.000Z"), false, 20, 20, false, false),
        makeSample(new Date("2025-06-03T12:00:00.000Z"), false, 20, 20, true,  false)
      ];
      const result = buildHeartbeatOverview(samples);
      expect(result.rainDays.positive).toBe(2);
      expect(result.rainDays.negative).toBe(1);
      expect(result.soilDays.positive).toBe(1);
      expect(result.soilDays.negative).toBe(2);
    });
  });

  // ── Sorting and range clamping ─────────────────────────────────────────────
  describe("sorting and range handling", () => {
    it("handles out-of-order input by sorting samples chronologically", () => {
      // Provide samples in reverse order: T1 guard=false, T0 guard=true
      const samples = [
        makeSample(T1, false, 30, 20),
        makeSample(T0, true, 30, 20)
      ];
      const result = buildHeartbeatOverview(samples, T0, T2);
      // After sort: guard on [T0,T1), off [T1,T2) → 1h active, 1h inactive
      expect(result.guard.activeMs).toBe(ONE_HOUR_MS);
      expect(result.guard.inactiveMs).toBe(ONE_HOUR_MS);
    });

    it("includes provided rangeStart in the range output", () => {
      const rangeStart = new Date("2025-06-01T00:00:00.000Z");
      const rangeEnd   = new Date("2025-06-02T00:00:00.000Z");
      const samples    = [makeSample(new Date("2025-06-01T12:00:00.000Z"), true, 30, 20)];
      const result     = buildHeartbeatOverview(samples, rangeStart, rangeEnd);
      expect(result.range.start).toBe(rangeStart.toISOString());
    });

    it("clamps interval boundaries to the requested range", () => {
      // Single sample at T1 (inside range T0–T2): should count T1→T2 only, not before T0
      const samples = [makeSample(T1, true, 30, 20)];
      const result  = buildHeartbeatOverview(samples, T0, T2);
      // Interval: intervalStart = clamp(T1, T0, T2) = T1, intervalEnd = clamp(T2, T0, T2) = T2
      expect(result.guard.activeMs).toBe(ONE_HOUR_MS);
    });

    it("returns zero totals when rangeEnd equals rangeStart", () => {
      const samples = [makeSample(T0, true, 30, 20)];
      const result  = buildHeartbeatOverview(samples, T0, T0); // zero-width range
      expect(result.guard.activeMs).toBe(0);
      expect(result.guard.inactiveMs).toBe(0);
    });
  });
});
