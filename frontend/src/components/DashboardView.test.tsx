import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import DashboardView from "./DashboardView";

/**
 * Component test for the DashboardView feature component extracted from App in
 * the Phase 3 decomposition. Heavy data-driven children are stubbed so the test
 * targets DashboardView's own composition and the derived UI it renders.
 */
vi.mock("./WeatherWidget", () => ({ default: () => <div data-testid="weather-widget" /> }));
vi.mock("./ZoneControlPanel", () => ({ default: () => <div data-testid="zone-control-panel" /> }));
vi.mock("./IrrigationQueuePanel", () => ({ default: () => <div data-testid="irrigation-queue-panel" /> }));
vi.mock("./RainAlertBanner", () => ({ default: () => <div data-testid="rain-alert-banner" /> }));
vi.mock("./OverviewSection", () => ({ default: () => <div data-testid="overview-section" /> }));
vi.mock("./status/StatusPanel", () => ({ StatusPanel: () => <div data-testid="status-panel" /> }));
vi.mock("../hooks/useChartTheme", () => ({ useChartTheme: () => ({}) }));

type Props = Parameters<typeof DashboardView>[0];

const baseProps = (overrides: Partial<Props> = {}): Props => ({
  status: null,
  latestHeartbeatSnapshot: null,
  forecast: null,
  forecastLoading: false,
  forecastError: null,
  overviewStats: null,
  overviewLoading: false,
  overviewError: null,
  heartbeatSeries: [],
  zones: [],
  zoneStates: {},
  zonesLoading: false,
  irrigationRecords: [],
  manualRun: null,
  rainPause: { active: false },
  irrigationMode: "smart",
  aiScheduleEnabled: false,
  lastAIRun: null,
  lastAIRunEntries: [],
  heartbeatError: null,
  startDate: null,
  endDate: null,
  onStartDateChange: vi.fn(),
  onEndDateChange: vi.fn(),
  onResetFilters: vi.fn(),
  historyFiltersRef: { current: null },
  rainAlertKey: 0,
  aiRunRefreshKey: 0,
  dashboardRunningAI: false,
  aiRunExpanded: false,
  setAiRunExpanded: vi.fn(),
  onReloadZones: vi.fn(),
  onRefreshRainPause: vi.fn(),
  onIrrigationModeChange: vi.fn(),
  onRunDashboardAI: vi.fn(),
  onOpenSettings: vi.fn(),
  ...overrides
});

describe("DashboardView", () => {
  it("renders the dashboard sections with empty data without crashing", () => {
    renderWithProviders(<DashboardView {...baseProps()} />);

    expect(screen.getByTestId("weather-widget")).toBeInTheDocument();
    expect(screen.getByTestId("status-panel")).toBeInTheDocument();
    expect(screen.getByTestId("zone-control-panel")).toBeInTheDocument();
    expect(screen.getByTestId("irrigation-queue-panel")).toBeInTheDocument();
    expect(screen.getByTestId("overview-section")).toBeInTheDocument();
    // No last AI run -> the fallback "AI Runs" heading is shown.
    expect(screen.getByText("AI Runs")).toBeInTheDocument();
    // Default history-window summary.
    expect(screen.getByText("History window")).toBeInTheDocument();
  });

  it("shows the heartbeat error banner when a heartbeat error is present", () => {
    renderWithProviders(
      <DashboardView {...baseProps({ heartbeatError: "boom" })} />
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("routes the reset-filters button through onResetFilters when a filter is active", async () => {
    const onResetFilters = vi.fn();
    renderWithProviders(
      <DashboardView
        {...baseProps({ startDate: new Date("2026-01-01T00:00:00Z"), onResetFilters })}
      />
    );
    await userEvent.click(screen.getByTitle("Reset filters"));
    expect(onResetFilters).toHaveBeenCalledOnce();
  });
});
