/**
 * Tests for the timezone-aware calendar-day key used to gate the rain prompt to at most
 * one appearance per day.
 */

jest.mock("../../models/configs/IrrigationSettings", () => ({ __esModule: true, default: {} }));
jest.mock("../../models/Config", () => ({ __esModule: true, default: {} }));

import { getDayKeyInTimezone } from "../irrigationSettingsService";

describe("getDayKeyInTimezone", () => {
  it("formats as YYYY-MM-DD in the given timezone", () => {
    expect(getDayKeyInTimezone(new Date("2026-07-11T15:00:00Z"), "America/New_York")).toBe("2026-07-11");
  });

  it("crosses the day boundary by timezone, not UTC", () => {
    // 03:30Z on the 11th is still 23:30 on the 10th in New York.
    const lateNight = new Date("2026-07-11T03:30:00Z");
    expect(getDayKeyInTimezone(lateNight, "America/New_York")).toBe("2026-07-10");
    expect(getDayKeyInTimezone(lateNight, "UTC")).toBe("2026-07-11");
  });

  it("two instants on the same local day share a key; across midnight they differ", () => {
    const tz = "America/New_York";
    const evening = new Date("2026-07-11T23:30:00-04:00");
    const laterSameDay = new Date("2026-07-11T23:59:00-04:00");
    const afterMidnight = new Date("2026-07-12T00:10:00-04:00");
    expect(getDayKeyInTimezone(evening, tz)).toBe(getDayKeyInTimezone(laterSameDay, tz));
    expect(getDayKeyInTimezone(evening, tz)).not.toBe(getDayKeyInTimezone(afterMidnight, tz));
  });

  it("handles DST transition days (Intl does the bookkeeping)", () => {
    // US spring-forward 2026: March 8. 06:30Z = 01:30 EST (same calendar day).
    expect(getDayKeyInTimezone(new Date("2026-03-08T06:30:00Z"), "America/New_York")).toBe("2026-03-08");
    // 03:00Z on March 9 is still 23:00 EDT on March 8.
    expect(getDayKeyInTimezone(new Date("2026-03-09T03:00:00Z"), "America/New_York")).toBe("2026-03-08");
  });
});
