import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatTimestamp,
  formatTimestampShort,
  formatHourLabel,
  formatDurationLabel,
  formatCountLabel,
  toQueryDateTime,
  formatRelativeTime,
  formatElapsedSince
} from "../date";

// All tests run with TZ=UTC (set in src/test/setup.ts) so formatting is
// deterministic across environments.

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------

describe("formatTimestamp", () => {
  it("formats a UTC ISO string as MM/d/yy hh:mm a", () => {
    // 2025-06-15 14:30 UTC → "06/15/25 02:30 PM"
    expect(formatTimestamp("2025-06-15T14:30:00.000Z")).toBe("06/15/25 02:30 PM");
  });

  it("formats midnight correctly", () => {
    expect(formatTimestamp("2025-01-01T00:00:00.000Z")).toBe("01/1/25 12:00 AM");
  });
});

// ---------------------------------------------------------------------------
// formatTimestampShort  (same format as formatTimestamp)
// ---------------------------------------------------------------------------

describe("formatTimestampShort", () => {
  it("produces the same output as formatTimestamp", () => {
    const iso = "2025-06-15T14:30:00.000Z";
    expect(formatTimestampShort(iso)).toBe(formatTimestamp(iso));
  });
});

// ---------------------------------------------------------------------------
// formatHourLabel
// ---------------------------------------------------------------------------

describe("formatHourLabel", () => {
  it("formats as 'MMM d, h a'", () => {
    expect(formatHourLabel("2025-06-15T14:00:00.000Z")).toBe("Jun 15, 2 PM");
  });

  it("handles midnight correctly", () => {
    expect(formatHourLabel("2025-01-01T00:00:00.000Z")).toBe("Jan 1, 12 AM");
  });
});

// ---------------------------------------------------------------------------
// formatDurationLabel
// ---------------------------------------------------------------------------

describe("formatDurationLabel", () => {
  it("returns null for 0 ms", () => {
    expect(formatDurationLabel(0)).toBeNull();
  });

  it("returns null for negative ms", () => {
    expect(formatDurationLabel(-1000)).toBeNull();
  });

  it("returns null for Infinity", () => {
    expect(formatDurationLabel(Infinity)).toBeNull();
  });

  it("returns null for NaN", () => {
    expect(formatDurationLabel(NaN)).toBeNull();
  });

  it("returns '1 min' for exactly 1 minute (60 000 ms)", () => {
    expect(formatDurationLabel(60_000)).toBe("1 min");
  });

  it("returns '1 min' for sub-minute durations (clamps to 1)", () => {
    expect(formatDurationLabel(30_000)).toBe("1 min"); // Math.max(1, round(0.5)) = 1
  });

  it("returns '30 min' for 30 minutes", () => {
    expect(formatDurationLabel(30 * 60_000)).toBe("30 min");
  });

  it("returns '1.0 h' for exactly 60 minutes", () => {
    expect(formatDurationLabel(60 * 60_000)).toBe("1.0 h");
  });

  it("returns '1.5 h' for 90 minutes", () => {
    expect(formatDurationLabel(90 * 60_000)).toBe("1.5 h");
  });

  it("returns '2.5 h' for 150 minutes", () => {
    expect(formatDurationLabel(150 * 60_000)).toBe("2.5 h");
  });

  it("returns 'X.Y ho' for >= 180 minutes (3-hour threshold)", () => {
    expect(formatDurationLabel(180 * 60_000)).toBe("3.0 ho");
  });

  it("returns '4.0 ho' for 240 minutes", () => {
    expect(formatDurationLabel(240 * 60_000)).toBe("4.0 ho");
  });

  it("returns rounded ho (no decimal) for >= 10 hours", () => {
    expect(formatDurationLabel(10 * 60 * 60_000)).toBe("10 ho");
  });

  it("returns '1.0 d' for exactly 24 hours (1440 min threshold)", () => {
    expect(formatDurationLabel(24 * 60 * 60_000)).toBe("1.0 d");
  });

  it("returns rounded days (no decimal) for >= 10 days", () => {
    expect(formatDurationLabel(10 * 24 * 60 * 60_000)).toBe("10 d");
  });
});

// ---------------------------------------------------------------------------
// formatCountLabel
// ---------------------------------------------------------------------------

describe("formatCountLabel", () => {
  it("uses singular form for a count of 1", () => {
    expect(formatCountLabel(1, "zone")).toBe("1 zone");
  });

  it("uses plural form for a count of 0", () => {
    expect(formatCountLabel(0, "zone")).toBe("0 zones");
  });

  it("uses plural form for a count of 2", () => {
    expect(formatCountLabel(2, "zone")).toBe("2 zones");
  });

  it("rounds fractional values before checking plural", () => {
    expect(formatCountLabel(1.4, "zone")).toBe("1 zone");
    expect(formatCountLabel(1.6, "zone")).toBe("2 zones");
  });

  it("clamps negative values to 0", () => {
    expect(formatCountLabel(-5, "zone")).toBe("0 zones");
  });
});

// ---------------------------------------------------------------------------
// toQueryDateTime
// ---------------------------------------------------------------------------

describe("toQueryDateTime", () => {
  it("returns undefined for null", () => {
    expect(toQueryDateTime(null)).toBeUndefined();
  });

  it("returns an ISO string for a valid Date", () => {
    const date = new Date("2025-06-15T14:00:00.000Z");
    expect(toQueryDateTime(date)).toBe("2025-06-15T14:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime  (depends on Date.now — use fake timers)
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns '—' for null", () => {
    expect(formatRelativeTime(null)).toBe("—");
  });

  it("returns '—' for an invalid date string", () => {
    expect(formatRelativeTime("not-a-date")).toBe("—");
  });

  it("returns a relative label for a past date (5 minutes ago)", () => {
    expect(formatRelativeTime("2025-06-15T11:55:00.000Z")).toBe("5 minutes ago");
  });

  it("returns a relative label for a past date (2 hours ago)", () => {
    expect(formatRelativeTime("2025-06-15T10:00:00.000Z")).toBe("2 hours ago");
  });
});

// ---------------------------------------------------------------------------
// formatElapsedSince  (depends on Date.now — use fake timers)
// ---------------------------------------------------------------------------

describe("formatElapsedSince", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns '' for null", () => {
    expect(formatElapsedSince(null)).toBe("");
  });

  it("returns '' for undefined", () => {
    expect(formatElapsedSince(undefined)).toBe("");
  });

  it("returns '' for an empty string", () => {
    expect(formatElapsedSince("")).toBe("");
  });

  it("returns '' for an invalid ISO string", () => {
    expect(formatElapsedSince("not-a-date")).toBe("");
  });

  it("returns '' for a future timestamp (negative delta)", () => {
    expect(formatElapsedSince("2025-06-15T13:00:00.000Z")).toBe("");
  });

  it("returns '1 min ago' when the delta is zero (clamps to 1 min)", () => {
    expect(formatElapsedSince("2025-06-15T12:00:00.000Z")).toBe("1 min ago");
  });

  it("returns '5 min ago' for a 5-minute-old timestamp", () => {
    expect(formatElapsedSince("2025-06-15T11:55:00.000Z")).toBe("5 min ago");
  });

  it("returns '59 min ago' just before the hour boundary", () => {
    expect(formatElapsedSince("2025-06-15T11:01:00.000Z")).toBe("59 min ago");
  });

  it("returns '1h ago' at exactly the hour boundary", () => {
    expect(formatElapsedSince("2025-06-15T11:00:00.000Z")).toBe("1h ago");
  });

  it("returns '3h ago' for a 3-hour-old timestamp", () => {
    expect(formatElapsedSince("2025-06-15T09:00:00.000Z")).toBe("3h ago");
  });

  it("returns '1d ago' for a 24-hour-old timestamp", () => {
    expect(formatElapsedSince("2025-06-14T12:00:00.000Z")).toBe("1d ago");
  });

  it("returns '7d ago' for a 7-day-old timestamp", () => {
    expect(formatElapsedSince("2025-06-08T12:00:00.000Z")).toBe("7d ago");
  });
});
