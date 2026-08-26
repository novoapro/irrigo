import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "./test/renderWithProviders";
import type { RealtimeEvent } from "./types";

/**
 * Characterization tests for the top-level App orchestrator.
 *
 * App.tsx is a ~1.7k-line component that owns all dashboard data loading, the
 * realtime event fan-out, and the polling refresh lifecycle. It has no existing
 * component tests, so these lock in its observable behavior (mounts, fires the
 * initial loads, reacts to realtime events) as a safety net before the React 19
 * migration decomposes it.
 *
 * Strategy: auto-mock the entire API layer (every call resolves to a benign
 * value) and stub the realtime/integration hooks so we can drive events
 * directly. Heavy data-driven children are stubbed so the unit under test is
 * App's own orchestration, not the whole component tree.
 */

// Capture the onEvent callback App wires into the realtime channel so tests can
// dispatch realtime events synchronously.
let capturedOnEvent: ((event: RealtimeEvent) => void) | null = null;

// Replace every API function with a stub that resolves to undefined so that
// promise chains (.then/.catch) and awaits in App and its children resolve
// cleanly. Non-function exports (types, constants) are passed through.
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(actual)) {
    mocked[key] =
      typeof value === "function" ? vi.fn().mockResolvedValue(undefined) : value;
  }
  return mocked;
});

vi.mock("./hooks/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: { onEvent: (event: RealtimeEvent) => void }) => {
    capturedOnEvent = opts.onEvent;
    return {
      status: "idle",
      isActive: false,
      isPreferenceEnabled: false,
      togglePreference: vi.fn(),
      activateManualSession: vi.fn(),
      deactivateManualSession: vi.fn(),
      resetBackoff: vi.fn()
    };
  }
}));

vi.mock("./hooks/useIntegrationHealth", () => ({
  useIntegrationHealth: () => ({ items: [], overall: "ok" })
}));

// Stub data-heavy children so the test targets App's orchestration only.
// Factories are inlined because vi.mock is hoisted above any local helpers.
vi.mock("./pages/RecordsPage", () => ({ default: () => <div data-testid="records-page" /> }));
vi.mock("./pages/IrrigationsPage", () => ({ default: () => <div data-testid="irrigations-page" /> }));
vi.mock("./pages/LogsPage", () => ({ default: () => <div data-testid="logs-page" /> }));
vi.mock("./pages/AIRunsPage", () => ({ default: () => <div data-testid="ai-runs-page" /> }));
vi.mock("./components/WeatherWidget", () => ({ default: () => <div data-testid="weather-widget" /> }));
vi.mock("./components/ZoneControlPanel", () => ({ default: () => <div data-testid="zone-control-panel" /> }));
vi.mock("./components/IrrigationQueuePanel", () => ({ default: () => <div data-testid="irrigation-queue-panel" /> }));
vi.mock("./components/SettingsPanel", () => ({ default: () => <div data-testid="settings-panel" /> }));
vi.mock("./components/OverviewSection", () => ({ default: () => <div data-testid="overview-section" /> }));
vi.mock("./components/HeaderHealthBar", () => ({ default: () => <div data-testid="header-health-bar" /> }));

import App from "./App";
import * as api from "./api";

const renderApp = () => renderWithProviders(<App />);

beforeEach(() => {
  capturedOnEvent = null;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("App", () => {
  it("mounts and renders the primary navigation", async () => {
    renderApp();

    // Nav links are keyed by their title attribute in the header.
    await waitFor(() => {
      expect(screen.getByTitle("Dashboard")).toBeInTheDocument();
    });
    expect(screen.getByTitle("Heartbeats")).toBeInTheDocument();
    expect(screen.getByTitle("Irrigations")).toBeInTheDocument();
    expect(screen.getByTitle("AI Runs")).toBeInTheDocument();
    expect(screen.getByTitle("Logs")).toBeInTheDocument();
    expect(screen.getByLabelText("Open settings")).toBeInTheDocument();
  });

  it("fires the initial data loads on mount", async () => {
    renderApp();

    await waitFor(() => {
      expect(api.fetchStatus).toHaveBeenCalled();
    });
    expect(api.fetchZones).toHaveBeenCalled();
    expect(api.fetchZoneStates).toHaveBeenCalled();
    expect(api.fetchSystemConfig).toHaveBeenCalled();
    expect(api.fetchHeartbeats).toHaveBeenCalled();
    expect(api.getManualRunStatus).toHaveBeenCalled();
  });

  it("reloads zones when a sequential run completes over the realtime channel", async () => {
    renderApp();

    await waitFor(() => {
      expect(capturedOnEvent).not.toBeNull();
    });

    // Ignore the initial mount loads; assert on the realtime-triggered reload.
    vi.mocked(api.fetchZones).mockClear();

    capturedOnEvent!({
      type: "sequentialRun:completed",
      payload: { id: "run-1" }
    } as unknown as RealtimeEvent);

    await waitFor(() => {
      expect(api.fetchZones).toHaveBeenCalled();
    });
  });

  it("does not crash on an unknown realtime event type", async () => {
    renderApp();

    await waitFor(() => {
      expect(capturedOnEvent).not.toBeNull();
    });

    expect(() =>
      capturedOnEvent!({ type: "totally:unknown" } as unknown as RealtimeEvent)
    ).not.toThrow();

    // Navigation still present -> app did not tear down.
    expect(screen.getByTitle("Dashboard")).toBeInTheDocument();
  });
});
