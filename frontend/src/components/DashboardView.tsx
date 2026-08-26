import { useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import DateTimeInput from "./DateTimeInput";
import WeatherWidget, { type PrecipitationPoint } from "./WeatherWidget";
import ZoneControlPanel from "./ZoneControlPanel";
import IrrigationQueuePanel from "./IrrigationQueuePanel";
import RainAlertBanner from "./RainAlertBanner";
import OverviewSection, { type OverviewCardDefinition } from "./OverviewSection";
import { type StatusTone } from "./status/SensorWidgets";
import { StatusPanel } from "./status/StatusPanel";
import { useChartTheme } from "../hooks/useChartTheme";
import type { RainPauseStatus } from "../api";
import type {
  Heartbeat,
  HeartbeatOverviewStats,
  HeartbeatSeriesSample,
  IrrigationMode,
  IrrigationRecord,
  ScheduleEntry,
  ScheduleRun,
  SequentialRun,
  StatusPayload,
  WeatherConditionsSnapshot,
  WeatherOverviewPayload,
  Zone,
  ZoneState
} from "../types";

export type SettingsTab =
  | "zones"
  | "device"
  | "irrigation"
  | "programs"
  | "integrations"
  | "preferences";

interface DashboardViewProps {
  // Server data (from the TanStack Query cache, owned by App)
  status: StatusPayload | null;
  latestHeartbeatSnapshot: Heartbeat | null;
  forecast: WeatherOverviewPayload | null;
  forecastLoading: boolean;
  forecastError: string | null;
  overviewStats: HeartbeatOverviewStats | null;
  overviewLoading: boolean;
  overviewError: string | null;
  heartbeatSeries: HeartbeatSeriesSample[];
  zones: Zone[];
  zoneStates: Record<string, ZoneState>;
  zonesLoading: boolean;
  irrigationRecords: IrrigationRecord[];
  manualRun: SequentialRun | null;
  rainPause: RainPauseStatus;
  irrigationMode: IrrigationMode;
  aiScheduleEnabled: boolean;
  lastAIRun: ScheduleRun | null;
  lastAIRunEntries: ScheduleEntry[];
  heartbeatError: string | null;
  // Filter state
  startDate: Date | null;
  endDate: Date | null;
  onStartDateChange: (value: Date | null) => void;
  onEndDateChange: (value: Date | null) => void;
  onResetFilters: () => void;
  historyFiltersRef: RefObject<HTMLDivElement | null>;
  // Cross-cutting UI state + handlers (owned by App)
  rainAlertKey: number;
  aiRunRefreshKey: number;
  dashboardRunningAI: boolean;
  aiRunExpanded: boolean;
  setAiRunExpanded: Dispatch<SetStateAction<boolean>>;
  onReloadZones: () => void;
  onRefreshRainPause: () => void;
  onIrrigationModeChange: (mode: IrrigationMode) => void;
  onRunDashboardAI: () => void;
  onOpenSettings: (tab: SettingsTab) => void;
}

const formatMetric = (value?: number) =>
  value === undefined || Number.isNaN(value) ? "—" : value.toFixed(1);

/**
 * The dashboard "/" route: weather, live status, zone control, the irrigation
 * queue, the last-AI-run summary, and the history window. Extracted from App as
 * a feature component (Phase 3 decomposition). It owns all the dashboard-only
 * derivations; App owns the queries, realtime, refresh orchestration, and the
 * cross-cutting UI state passed in here.
 */
const DashboardView = ({
  status,
  latestHeartbeatSnapshot,
  forecast,
  forecastLoading,
  forecastError,
  overviewStats,
  overviewLoading,
  overviewError,
  heartbeatSeries,
  zones,
  zoneStates,
  zonesLoading,
  irrigationRecords,
  manualRun,
  rainPause,
  irrigationMode,
  aiScheduleEnabled,
  lastAIRun,
  lastAIRunEntries,
  heartbeatError,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onResetFilters,
  historyFiltersRef,
  rainAlertKey,
  aiRunRefreshKey,
  dashboardRunningAI,
  aiRunExpanded,
  setAiRunExpanded,
  onReloadZones,
  onRefreshRainPause,
  onIrrigationModeChange,
  onRunDashboardAI,
  onOpenSettings
}: DashboardViewProps) => {
  const chartTheme = useChartTheme();

  const trendData = useMemo(
    () =>
      [...heartbeatSeries]
        .sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
        .map((sample) => ({
          timestamp: sample.timestamp,
          psi: sample.psi
        })),
    [heartbeatSeries]
  );

  const guardActive = status?.guard ?? latestHeartbeatSnapshot?.guard ?? false;

  const currentWeather = useMemo((): WeatherConditionsSnapshot | null => {
    if (forecast) {
      return {
        locationName: forecast.locationName,
        fetchedAt: forecast.fetchedAt,
        // Fall the expiry back to one hour after the fetch time (a pure value)
        // rather than the render clock, so the mapping stays idempotent.
        expiresAt:
          forecast.expiresAt ??
          new Date(new Date(forecast.fetchedAt).getTime() + 3600000).toISOString(),
        periodStart: forecast.periodStart ?? null,
        periodEnd: forecast.periodEnd ?? null,
        temperature: forecast.temperature ?? null,
        temperatureUnit: forecast.temperatureUnit ?? null,
        precipitationProbability: forecast.precipitationProbability ?? null,
        isDaytime: forecast.isDaytime ?? null,
        shortForecast: forecast.shortForecast ?? null
      };
    }
    return null;
  }, [forecast]);

  const connectedSensors = useMemo(
    () =>
      Array.from(
        new Set(
          status?.device.connectedSensors ??
          latestHeartbeatSnapshot?.device.connectedSensors ??
          []
        )
      ),
    [status, latestHeartbeatSnapshot]
  );

  const latestBaselinePsi =
    status?.device?.baselinePsi ?? latestHeartbeatSnapshot?.device.baselinePsi;
  const latestWaterPsi =
    status?.sensors?.waterPsi ?? latestHeartbeatSnapshot?.sensors.waterPsi;

  const rainStatus = connectedSensors.includes("RAIN") ? (
    status ? status.sensors.rain
      ? "Detected"
      : "No"
      : latestHeartbeatSnapshot
        ? latestHeartbeatSnapshot.sensors.rain
          ? "Detected"
          : "No"
        : "No data")
    : "Ignored";

  const rainStatusTone: StatusTone = connectedSensors.includes("RAIN") ? (
    status ? status.sensors.rain
      ? "negative"
      : "positive"
      : latestHeartbeatSnapshot
        ? latestHeartbeatSnapshot.sensors.rain
          ? "negative"
          : "positive"
        : "informative")
    : "warning";

  const soilStatus = connectedSensors.includes("SOIL") ? (
    status
      ? status.sensors.soil
        ? "Saturated"
        : "Dry"
      : latestHeartbeatSnapshot
        ? latestHeartbeatSnapshot.sensors.soil
          ? "Saturated"
          : "Dry"
        : "No data")
    : "Ignored";

  const soilStatusTone: StatusTone = connectedSensors.includes("SOIL") ? (
    status
      ? status.sensors.soil
        ? "negative"
        : "positive"
      : latestHeartbeatSnapshot
        ? latestHeartbeatSnapshot.sensors.soil
          ? "negative"
          : "positive"
        : "informative")
    : "warning";

  const statusIrrigation = useMemo(() => {
    const irrigation = status?.irrigation;
    if (!irrigation) return null;
    return {
      zone: irrigation.zone,
      action: irrigation.action ?? null
    };
  }, [status]);

  const lastIrrigationChange = useMemo(() => {
    const statusTs = status?.changes?.irrigation ?? null;
    const parsed = statusTs ? Date.parse(statusTs) : null;
    return parsed && Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }, [status]);

  const precipitationSeries = useMemo<PrecipitationPoint[]>(() => {
    if (!forecast) {
      return [];
    }
    // Anchor "future" to the forecast fetch time (a pure value) instead of the
    // render clock; the forecast refetches often enough to stay current.
    const anchor = new Date(forecast.fetchedAt).getTime();
    return forecast.precipitationOutlook
      .filter((entry) => new Date(entry.periodStart).getTime() >= anchor)
      .map((entry) => ({
        timestamp: entry.periodStart,
        probability: entry.probability ?? 0
      }));
  }, [forecast]);

  const { overviewCards, pressureOverview } = useMemo(() => {
    if (!overviewStats) {
      return {
        overviewCards: [] as OverviewCardDefinition[],
        pressureOverview: null as OverviewCardDefinition | null
      };
    }

    const guardTotal = overviewStats.guard.activeMs + overviewStats.guard.inactiveMs;
    const rainTotal = overviewStats.rainDays.positive + overviewStats.rainDays.negative;
    const soilTotal = overviewStats.soilDays.positive + overviewStats.soilDays.negative;
    const pressureTotal =
      overviewStats.pressure.activeMs + overviewStats.pressure.inactiveMs;

    const cards: OverviewCardDefinition[] = [
      {
        key: "guard",
        title: "Guard status time",
        unit: "duration",
        unitLabel: "minute",
        total: guardTotal,
        data: [
          {
            key: "guard-active",
            name: "Guard active",
            value: overviewStats.guard.activeMs,
            color: chartTheme.danger
          },
          {
            key: "guard-ready",
            name: "Guard ready",
            value: overviewStats.guard.inactiveMs,
            color: chartTheme.success
          }
        ]
      },
      {
        key: "rain",
        title: "Rain detected",
        unit: "count",
        unitLabel: "day",
        total: rainTotal,
        data: [
          {
            key: "rainy",
            name: "Rainy",
            value: overviewStats.rainDays.positive,
            color: chartTheme.info
          },
          {
            key: "clear",
            name: "Dry",
            value: overviewStats.rainDays.negative,
            color: chartTheme.muted
          }
        ]
      },
      {
        key: "soil",
        title: "Soil moisture",
        unit: "count",
        unitLabel: "day",
        total: soilTotal,
        data: [
          {
            key: "saturated",
            name: "Saturated",
            value: overviewStats.soilDays.positive,
            color: chartTheme.green
          },
          {
            key: "dry",
            name: "Dry",
            value: overviewStats.soilDays.negative,
            color: chartTheme.amber
          }
        ]
      },
      {
        key: "pressure",
        title: "Water Press",
        unit: "duration",
        unitLabel: "minute",
        total: pressureTotal,
        data: [
          {
            key: "above",
            name: "Above baseline",
            value: overviewStats.pressure.activeMs,
            color: chartTheme.indigo
          },
          {
            key: "below",
            name: "At or below",
            value: overviewStats.pressure.inactiveMs,
            color: chartTheme.indigoLight
          }
        ]
      }
    ];

    return {
      overviewCards: cards.filter((card) => card.key !== "pressure"),
      pressureOverview: cards.find((card) => card.key === "pressure") ?? null
    };
  }, [overviewStats, chartTheme]);

  const filterActive = Boolean(startDate || endDate);

  const filterSummary = useMemo(() => {
    if (!filterActive) {
      return "Showing entire history";
    }
    const startLabel = startDate
      ? format(startDate, "MMM d • h:mm a")
      : "Beginning";
    const endLabel = endDate
      ? format(endDate, "MMM d • h:mm a")
      : "Now";
    return `${startLabel} – ${endLabel}`;
  }, [filterActive, startDate, endDate]);

  const overviewSubtitle =
    filterSummary === "Showing entire history" ? "the entire history" : filterSummary;

  const waterPressureMeta = useMemo(() => {
    if (latestWaterPsi === undefined) {
      return {
        status: "No data",
        tone: "informative" as const,
        detail:
          latestBaselinePsi !== undefined
            ? `Baseline ${latestBaselinePsi.toFixed(1)} psi`
            : undefined
      };
    }

    if (latestBaselinePsi === undefined) {
      return {
        status: `${formatMetric(latestWaterPsi)} psi`,
        tone: "informative" as const,
        detail: undefined
      };
    }

    const tone: "positive" | "negative" =
      latestWaterPsi >= latestBaselinePsi ? "positive" : "negative";

    return {
      status: `${formatMetric(latestWaterPsi)} psi`,
      tone,
      detail: `Baseline ${latestBaselinePsi.toFixed(1)} psi`
    };
  }, [latestWaterPsi, latestBaselinePsi]);

  return (
    <>
      {heartbeatError ? <div className="error-banner">{heartbeatError}</div> : null}

      <RainAlertBanner refreshKey={rainAlertKey} onConfirmed={onRefreshRainPause} />

      <WeatherWidget
        loading={forecastLoading}
        error={forecastError}
        currentWeather={currentWeather}
        fallbackLocation={forecast?.locationName ?? null}
        fallbackUpdatedAt={forecast?.fetchedAt ?? null}
        precipitationSeries={precipitationSeries}
      />

      <StatusPanel
        guard={guardActive}
        irrigation={statusIrrigation}
        lastIrrigationChange={lastIrrigationChange}
        zones={zones}
        pressureStatus={waterPressureMeta.status}
        pressureTone={waterPressureMeta.tone}
        pressureDetail={waterPressureMeta.detail}
        pressureActive={connectedSensors.includes("PRESSURE")}
        rainStatus={rainStatus}
        rainTone={rainStatusTone}
        rainActive={connectedSensors.includes("RAIN")}
        soilStatus={soilStatus}
        soilTone={soilStatusTone}
        soilActive={connectedSensors.includes("SOIL")}
        rainPause={rainPause}
        onRainReported={onRefreshRainPause}
      />

      <ZoneControlPanel
        zones={zones}
        zoneStates={zoneStates}
        loading={zonesLoading}
        onZonesChanged={onReloadZones}
        mode="control"
        onOpenSettings={() => onOpenSettings("zones")}
        irrigationRecords={irrigationRecords}
        baselinePsi={latestBaselinePsi}
        manualRun={manualRun}
        guardActive={guardActive}
      />

      <IrrigationQueuePanel
        zones={zones}
        irrigationMode={irrigationMode}
        aiScheduleEnabled={aiScheduleEnabled}
        refreshKey={aiRunRefreshKey}
        onModeChanged={(mode) => onIrrigationModeChange(mode)}
        onScheduleChanged={onReloadZones}
        onOpenSmartSettings={() => onOpenSettings("irrigation")}
        onOpenProgramSettings={() => onOpenSettings("programs")}
      />

      <section className="ai-run-summary">
        <div className="ai-run-summary__top-row">
          {lastAIRun && (
            <button
              type="button"
              className="ai-run-summary__header"
              onClick={() => setAiRunExpanded((v) => !v)}
            >
              <h3>Last AI Run</h3>
              <span className={`schedule-status-pill schedule-status-pill--${lastAIRun.status}`}>
                {lastAIRun.status}
              </span>
              <span className="ai-run-summary__time">
                {new Date(lastAIRun.startedAt).toLocaleString("en-US", {
                  month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true
                })}
              </span>
              <span className="muted" style={{ fontSize: "var(--text-xs)" }}>
                {lastAIRun.triggeredBy === "cron" ? "auto" : "manual"}
                {typeof lastAIRun.entries === "number" && lastAIRun.entries > 0
                  ? ` · ${lastAIRun.entries} zone${lastAIRun.entries !== 1 ? "s" : ""}`
                  : ""}
              </span>
            </button>
          )}
          {!lastAIRun && <h3 style={{ margin: 0 }}>AI Runs</h3>}
          {aiScheduleEnabled && (
            <button
              type="button"
              className={`icon-btn ai-run-status-btn ai-run-status-btn--${dashboardRunningAI ? "running" : lastAIRun?.status === "completed" ? "success" : lastAIRun?.status ?? "none"}`}
              disabled={dashboardRunningAI}
              onClick={onRunDashboardAI}
              title={dashboardRunningAI ? "Running..." : "Run AI Run"}
              aria-label={dashboardRunningAI ? "Running..." : "Run AI Run"}
            >
              {dashboardRunningAI ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
              )}
            </button>
          )}
        </div>
        {lastAIRun && aiRunExpanded && (
          <div className="ai-run-summary__body">
            {lastAIRun.reasoning && (
              <p className="ai-run-summary__reasoning">{lastAIRun.reasoning}</p>
            )}
            {lastAIRun.errorMessage && (
              <p className="ai-run-summary__error">{lastAIRun.errorMessage}</p>
            )}
            {lastAIRunEntries.length > 0 && (
              <div className="ai-run-summary__entries">
                {lastAIRunEntries.map((entry) => {
                  const zone = zones.find((z) => z.zoneId === entry.zoneId);
                  return (
                    <div className="ai-run-summary__entry" key={entry._id}>
                      <span className="ai-run-summary__zone-name">{zone?.name ?? entry.zoneId}</span>
                      <span className="ai-run-summary__zone-dur">{entry.plannedDurationMinutes} min</span>
                      <span className="ai-run-summary__zone-time">
                        {new Date(entry.plannedStartAt).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <Link to="/ai-runs" className="ai-run-summary__cta">
              View all AI Runs
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </Link>
          </div>
        )}
      </section>

      <section className="history-window">
        <article className="history-window-card">
          <header className="history-window-header">
            <div>
              <h3>History window</h3>
              <p className="muted">{filterSummary}</p>
            </div>
          </header>
          <div className="history-window-filters" ref={historyFiltersRef}>
            <div className="records-filters__row">
              <div className="time-filter-field">
                <label htmlFor="history-start">From</label>
                <DateTimeInput
                  value={startDate}
                  onChange={onStartDateChange}
                  max={endDate ?? new Date()}
                  placeholder="Beginning of time"
                  clearable
                />
              </div>
              <div className="time-filter-field">
                <label htmlFor="history-end">To</label>
                <DateTimeInput
                  value={endDate}
                  onChange={onEndDateChange}
                  min={startDate ?? undefined}
                  max={new Date()}
                  placeholder="Now"
                  clearable
                />
              </div>
            </div>
            {filterActive && (
              <button
                type="button"
                className="history-filter-reset"
                onClick={onResetFilters}
                title="Reset filters"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </div>
          <div className="history-window-section" aria-label="Analytics">
            <OverviewSection
              cards={overviewCards}
              pressureOverview={pressureOverview}
              trendData={trendData}
              latestBaselinePsi={latestBaselinePsi}
              subtitle={overviewSubtitle}
              loading={overviewLoading}
              error={overviewError}
            />
          </div>
        </article>
      </section>
    </>
  );
};

export default DashboardView;
