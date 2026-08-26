import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import ZoneCard from "./ZoneCard";
import type { Zone, ZoneState } from "../types";

/**
 * Behavioral tests for ZoneCard's derived-clock countdown.
 *
 * The remaining time is derived in render from a ticking `useNow` clock (no
 * interval + setState effect). While a zone is active it counts down; when
 * inactive the clock is frozen and no live countdown is shown. Time is driven
 * with fake timers.
 */

const BASE = new Date("2026-08-26T12:00:00Z");

const makeZone = (overrides: Partial<Zone> = {}): Zone => ({
  zoneId: "alpha",
  name: "Alpha",
  enabled: true,
  sortOrder: 0,
  defaultDurationMinutes: 10,
  maxDurationMinutes: 60,
  ...overrides
});

const baseProps = {
  zone: makeZone(),
  onToggleEnabled: vi.fn(),
  onCommand: vi.fn(),
  commandPending: false,
  awaitingConfirmation: null,
  lastIrrigation: null
} as const;

const renderCard = (state: ZoneState | null) =>
  renderWithProviders(<ZoneCard {...baseProps} state={state} />);

const countdownText = () =>
  document.querySelector(".zone-card__countdown")?.textContent ?? "";

const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ZoneCard countdown", () => {
  it("counts down from the active duration and start time", () => {
    renderCard({
      zoneId: "alpha",
      isActive: true,
      lastAction: "on",
      lastEventAt: BASE.toISOString(),
      activeDurationMinutes: 10
    });

    expect(countdownText()).toBe("10:00");
    tick(3000);
    expect(countdownText()).toBe("9:57");
    tick(57_000);
    expect(countdownText()).toBe("9:00");
  });

  it("counts down from server remainingSeconds/remainingUpdatedAt when provided", () => {
    renderCard({
      zoneId: "alpha",
      isActive: true,
      lastAction: "on",
      lastEventAt: BASE.toISOString(),
      remainingSeconds: 120,
      remainingUpdatedAt: BASE.toISOString()
    });

    expect(countdownText()).toBe("2:00");
    tick(10_000);
    expect(countdownText()).toBe("1:50");
  });

  it("floors the countdown at 0:00 once the duration elapses", () => {
    renderCard({
      zoneId: "alpha",
      isActive: true,
      lastAction: "on",
      lastEventAt: BASE.toISOString(),
      activeDurationMinutes: 1
    });

    expect(countdownText()).toBe("1:00");
    tick(90_000);
    expect(countdownText()).toBe("0:00");
  });

  it("shows no live countdown when the zone is inactive", () => {
    renderCard({
      zoneId: "alpha",
      isActive: false,
      lastAction: "off",
      lastEventAt: BASE.toISOString(),
      activeDurationMinutes: 10
    });

    // Progress panel is hidden and the value stays at 0:00 as time advances
    // (the clock is frozen while inactive).
    expect(
      document.querySelector(".zone-card__panel-progress")?.className
    ).toContain("zone-card__panel--hidden");
    expect(countdownText()).toBe("0:00");
    tick(5000);
    expect(countdownText()).toBe("0:00");
  });
});
