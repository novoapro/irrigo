import { type Dispatch, type RefObject, type SetStateAction } from "react";
import { format } from "date-fns";
import WeatherWidget, { type PrecipitationPoint } from "./WeatherWidget";
import ZoneControlPanel from "./ZoneControlPanel";
import IrrigationQueuePanel from "./IrrigationQueuePanel";
import RainAlertBanner from "./RainAlertBanner";
import { type OverviewCardDefinition } from "./OverviewSection";
import { StatusPanel } from "./status/StatusPanel";
import { readSensor } from "../utils/sensors";
import AIRunSummary from "./dashboard/AIRunSummary";
import HistoryWindow from "./dashboard/HistoryWindow";
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

  // Derivations are plain — the React Compiler memoizes them.
  const trendData = [...heartbeatSeries]
    .sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    .map((sample) => ({ timestamp: sample.timestamp, psi: sample.psi }));

  const guardActive = status?.guard ?? latestHeartbeatSnapshot?.guard ?? false;

  const currentWeather: WeatherConditionsSnapshot | null = forecast
    ? {
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
      }
    : null;

  const connectedSensors = Array.from(
    new Set(
      status?.device.connectedSensors ??
      latestHeartbeatSnapshot?.device.connectedSensors ??
      []
    )
  );

  const latestBaselinePsi =
    status?.device?.baselinePsi ?? latestHeartbeatSnapshot?.device.baselinePsi;
  const latestWaterPsi =
    status?.sensors?.waterPsi ?? latestHeartbeatSnapshot?.sensors.waterPsi;

  // Each boolean sensor's label + tone + active flag comes from one shared
  // decision tree (see readSensor) instead of the four near-identical nested
  // ternaries this used to be. `live` reads from the live status payload (or
  // undefined when there is none) and `snapshot` is the heartbeat fallback.
  const rain = readSensor(
    connectedSensors.includes("RAIN"),
    status ? status.sensors.rain : undefined,
    latestHeartbeatSnapshot ? latestHeartbeatSnapshot.sensors.rain : undefined,
    { on: "Detected", off: "No" }
  );

  const soil = readSensor(
    connectedSensors.includes("SOIL"),
    status ? status.sensors.soil : undefined,
    latestHeartbeatSnapshot ? latestHeartbeatSnapshot.sensors.soil : undefined,
    { on: "Saturated", off: "Dry" }
  );

  const statusIrrigation = status?.irrigation
    ? { zone: status.irrigation.zone, action: status.irrigation.action ?? null }
    : null;

  const lastIrrigationChange = (() => {
    const statusTs = status?.changes?.irrigation ?? null;
    const parsed = statusTs ? Date.parse(statusTs) : null;
    return parsed && Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  })();

  // Anchor "future" to the forecast fetch time (a pure value) instead of the
  // render clock; the forecast refetches often enough to stay current.
  const precipitationSeries: PrecipitationPoint[] = forecast
    ? forecast.precipitationOutlook
        .filter(
          (entry) =>
            new Date(entry.periodStart).getTime() >=
            new Date(forecast.fetchedAt).getTime()
        )
        .map((entry) => ({
          timestamp: entry.periodStart,
          probability: entry.probability ?? 0
        }))
    : [];

  const { overviewCards, pressureOverview } = ((): {
    overviewCards: OverviewCardDefinition[];
    pressureOverview: OverviewCardDefinition | null;
  } => {
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
  })();

  const filterActive = Boolean(startDate || endDate);

  const filterSummary = !filterActive
    ? "Showing entire history"
    : `${startDate ? format(startDate, "MMM d • h:mm a") : "Beginning"} – ${
        endDate ? format(endDate, "MMM d • h:mm a") : "Now"
      }`;

  const overviewSubtitle =
    filterSummary === "Showing entire history" ? "the entire history" : filterSummary;

  const waterPressureMeta = ((): {
    status: string;
    tone: "positive" | "negative" | "informative";
    detail?: string;
  } => {
    if (latestWaterPsi === undefined) {
      return {
        status: "No data",
        tone: "informative",
        detail:
          latestBaselinePsi !== undefined
            ? `Baseline ${latestBaselinePsi.toFixed(1)} psi`
            : undefined
      };
    }

    if (latestBaselinePsi === undefined) {
      return {
        status: `${formatMetric(latestWaterPsi)} psi`,
        tone: "informative",
        detail: undefined
      };
    }

    return {
      status: `${formatMetric(latestWaterPsi)} psi`,
      tone: latestWaterPsi >= latestBaselinePsi ? "positive" : "negative",
      detail: `Baseline ${latestBaselinePsi.toFixed(1)} psi`
    };
  })();

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
        pressure={{
          status: waterPressureMeta.status,
          tone: waterPressureMeta.tone,
          active: connectedSensors.includes("PRESSURE")
        }}
        pressureDetail={waterPressureMeta.detail}
        rain={rain}
        soil={soil}
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

      <AIRunSummary
        lastAIRun={lastAIRun}
        lastAIRunEntries={lastAIRunEntries}
        aiScheduleEnabled={aiScheduleEnabled}
        dashboardRunningAI={dashboardRunningAI}
        aiRunExpanded={aiRunExpanded}
        setAiRunExpanded={setAiRunExpanded}
        onRunDashboardAI={onRunDashboardAI}
        zones={zones}
      />

      <HistoryWindow
        filterSummary={filterSummary}
        historyFiltersRef={historyFiltersRef}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={onStartDateChange}
        onEndDateChange={onEndDateChange}
        filterActive={filterActive}
        onResetFilters={onResetFilters}
        overviewCards={overviewCards}
        pressureOverview={pressureOverview}
        trendData={trendData}
        latestBaselinePsi={latestBaselinePsi}
        overviewSubtitle={overviewSubtitle}
        overviewLoading={overviewLoading}
        overviewError={overviewError}
      />
    </>
  );
};

export default DashboardView;
