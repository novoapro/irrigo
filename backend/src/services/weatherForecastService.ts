import WeatherForecastSnapshot, {
  WeatherForecastSnapshotAttributes
} from "../models/WeatherForecastSnapshot";
import PrecipitationHistory from "../models/PrecipitationHistory";
import { emitRealtimeEvent } from "../services/realtimeService";
import {
  WEATHER_API_BASE,
  WEATHER_FORECAST_TTL_MS,
  WEATHER_GRID_X,
  WEATHER_GRID_Y,
  WEATHER_LOCATION_NAME,
  WEATHER_OFFICE,
  WEATHER_USER_AGENT,
  WEATHER_AUTO_REFRESH_MS,
  WEATHER_FORECAST_REFRESH_THRESHOLD_MS
} from "../config/weather";

export interface WeatherGovForecastPeriod {
  startTime: string;
  endTime: string;
  temperature: number | null;
  temperatureUnit: string | null;
  isDaytime: boolean | null;
  probabilityOfPrecipitation: {
    unitCode: string | null;
    value: number | null;
  };
  shortForecast: string | null;
}

export interface ParsedForecastPeriod {
  startTime: Date;
  endTime: Date;
  isDaytime: boolean | null;
  temperature: number | null;
  temperatureUnit: string | null;
  probabilityOfPrecipitation: number | null;
  shortForecast: string | null;
}

interface WeatherGovForecastResponse {
  properties: {
    updated: string;
    periods: WeatherGovForecastPeriod[];
  };
}

const getForecastUrl = (office: string, gridX: number, gridY: number) =>
  `${WEATHER_API_BASE}/gridpoints/${office}/${gridX},${gridY}/forecast/hourly`;

export const safeDate = (value: string | Date | undefined | null): Date => {
  if (!value) {
    return new Date();
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

export const convertPeriod = (period: WeatherGovForecastPeriod): ParsedForecastPeriod => ({
  startTime: safeDate(period.startTime),
  endTime: safeDate(period.endTime),
  temperature: period.temperature,
  temperatureUnit: period.temperatureUnit,
  isDaytime: period.isDaytime,
  probabilityOfPrecipitation: period.probabilityOfPrecipitation?.value ?? null,
  shortForecast: period.shortForecast ?? null
});

const toSnapshotPeriods = (
  periods: ParsedForecastPeriod[]
): WeatherForecastSnapshotAttributes["periods"] =>
  periods.map((period) => ({
    startTime: period.startTime,
    endTime: period.endTime,
    temperature: period.temperature,
    temperatureUnit: period.temperatureUnit,
    isDaytime: period.isDaytime ?? null,
    precipitationProbability: period.probabilityOfPrecipitation ?? null,
    shortForecast: period.shortForecast ?? null
  }));

export const findCurrentPeriod = (
  periods: ParsedForecastPeriod[],
  nowMs = Date.now()
): ParsedForecastPeriod | null => {
  return (
    periods.find(
      (period) =>
        period.startTime.getTime() <= nowMs && period.endTime.getTime() > nowMs
    ) ?? periods[0] ?? null
  );
};

const normalizeSnapshotPeriods = (
  snapshot: WeatherForecastSnapshotAttributes
): ParsedForecastPeriod[] =>
  (snapshot.periods ?? [])
    .map((period) => ({
      startTime: safeDate(period.startTime),
      endTime: safeDate(period.endTime),
      temperature: period.temperature,
      temperatureUnit: period.temperatureUnit,
      isDaytime: period.isDaytime,
      probabilityOfPrecipitation: period.precipitationProbability,
      shortForecast: period.shortForecast
    }))
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

const getSnapshotPeriodsAndCurrent = (
  snapshot: WeatherForecastSnapshotAttributes,
  nowMs = Date.now()
) => {
  const periods = normalizeSnapshotPeriods(snapshot);
  const currentPeriod = periods.length ? findCurrentPeriod(periods, nowMs) : null;
  return { periods, currentPeriod };
};

export const findNextPeriodStart = (
  periods: ParsedForecastPeriod[],
  nowMs = Date.now()
): number | null => {
  const next = periods.find(
    (period) => period.startTime.getTime() > nowMs
  );
  return next?.startTime.getTime() ?? null;
};

const savePrecipitationHistory = async (
  periods: ParsedForecastPeriod[],
  fetchedAt: Date
) => {
  // Get the start of today (midnight)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const bulkOps = periods
    .filter((period) => 
      // Keep periods from today onwards
      period.startTime.getTime() >= today.getTime() && 
      // Keep only periods with valid precipitation probability
      typeof period.probabilityOfPrecipitation === "number"
    )
    .map((period) => {
      const probability = period.probabilityOfPrecipitation as number;
      return {
        updateOne: {
          filter: {
            periodStart: period.startTime
          },
          update: {
            $set: {
              probability,
              fetchedAt,
              office: WEATHER_OFFICE,
              gridX: WEATHER_GRID_X,
              gridY: WEATHER_GRID_Y
            }
          },
          upsert: true
        }
      };
    });

  if (bulkOps.length > 0) {
    await PrecipitationHistory.bulkWrite(bulkOps);
  }

  await PrecipitationHistory.deleteMany({
    office: WEATHER_OFFICE,
    gridX: WEATHER_GRID_X,
    gridY: WEATHER_GRID_Y,
    periodStart: { $lt: today }
  });
};

const fetchForecastFromApi = async (): Promise<
  WeatherForecastSnapshotAttributes
> => {
  const url = getForecastUrl(WEATHER_OFFICE, WEATHER_GRID_X, WEATHER_GRID_Y);
  const response = await fetch(url, {
    headers: {
      "User-Agent": WEATHER_USER_AGENT
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Weather API failed with status ${response.status}: ${
        text || response.statusText
      }`
    );
  }

  const payload = (await response.json()) as WeatherGovForecastResponse;
  const periods = payload.properties.periods.map(convertPeriod);
  const fetchedAt = safeDate(payload.properties.updated);
  const expiresAt = new Date(fetchedAt.getTime() + WEATHER_FORECAST_TTL_MS);
  const currentPeriod = findCurrentPeriod(periods);

  const snapshotData: WeatherForecastSnapshotAttributes = {
    office: WEATHER_OFFICE,
    gridX: WEATHER_GRID_X,
    gridY: WEATHER_GRID_Y,
    locationName: WEATHER_LOCATION_NAME,
    fetchedAt,
    expiresAt,
    periodStart: currentPeriod?.startTime ?? null,
    periodEnd: currentPeriod?.endTime ?? null,
    temperature: currentPeriod?.temperature ?? null,
    temperatureUnit: currentPeriod?.temperatureUnit ?? null,
    precipitationProbability:
      currentPeriod?.probabilityOfPrecipitation ?? null,
    isDaytime: currentPeriod?.isDaytime ?? null,
    shortForecast: currentPeriod?.shortForecast ?? null,
    periods: toSnapshotPeriods(periods)
  };

  const snapshot = await WeatherForecastSnapshot.findOneAndUpdate(
    { office: WEATHER_OFFICE, gridX: WEATHER_GRID_X, gridY: WEATHER_GRID_Y },
    snapshotData,
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  ).lean<WeatherForecastSnapshotAttributes>();

  await savePrecipitationHistory(periods, fetchedAt);

  emitRealtimeEvent({
    type: "forecast:new",
    payload: await buildWeatherOverview(snapshot)
  });
  void scheduleForecastPeriodPush(snapshot);

  return snapshot ?? snapshotData;
};

const getCachedForecast = async () => {
  const now = new Date();
  const snapshot = await WeatherForecastSnapshot.findOne({
    office: WEATHER_OFFICE,
    gridX: WEATHER_GRID_X,
    gridY: WEATHER_GRID_Y,
    expiresAt: { $gt: now }
  })
    .sort({ fetchedAt: -1 })
    .lean();

  return snapshot ?? null;
};

const getLatestSnapshot = async () => {
  const snapshot = await WeatherForecastSnapshot.findOne({
    office: WEATHER_OFFICE,
    gridX: WEATHER_GRID_X,
    gridY: WEATHER_GRID_Y
  })
    .sort({ fetchedAt: -1 })
    .lean();

  return snapshot ?? null;
};

let inFlightFetch: Promise<WeatherForecastSnapshotAttributes> | null = null;
let periodChangeTimeout: NodeJS.Timeout | null = null;

const getOrCreateFetchPromise = () => {
  if (!inFlightFetch) {
    inFlightFetch = fetchForecastFromApi().finally(() => {
      inFlightFetch = null;
    });
  }
  return inFlightFetch;
};

export const ensureForecastSnapshot = async () => {
  const cached = await getCachedForecast();
  if (cached) {
    const millisToExpiry = cached.expiresAt.getTime() - Date.now();
    if (millisToExpiry > WEATHER_FORECAST_REFRESH_THRESHOLD_MS) {
      return cached;
    }
    // Near expiry: return cached but trigger background refresh.
    void getOrCreateFetchPromise().catch((error) => {
      console.error("Weather API background refresh failed:", error);
    });
    return cached;
  }

  try {
    return await getOrCreateFetchPromise();
  } catch (error) {
    console.error("Weather API request failed, attempting cached fallback:", error);
    const fallback = await getLatestSnapshot();
    if (fallback) {
      return fallback;
    }
    throw error;
  }
};

export interface PrecipitationOutlookEntry {
  periodStart: Date;
  probability: number;
}

export interface CurrentWeatherConditions {
  locationName: string;
  fetchedAt: Date;
  expiresAt: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
  temperature: number | null;
  temperatureUnit: string | null;
  precipitationProbability: number | null;
  isDaytime: boolean | null;
  shortForecast: string | null;
}

export interface WeatherOverviewPayload extends CurrentWeatherConditions {
  precipitationOutlook: PrecipitationOutlookEntry[];
}

const mapSnapshotToCurrentConditions = (
  snapshot: WeatherForecastSnapshotAttributes
): CurrentWeatherConditions => {
  const { periods, currentPeriod } = getSnapshotPeriodsAndCurrent(snapshot);

  return {
    locationName: snapshot.locationName,
    fetchedAt: snapshot.fetchedAt,
    expiresAt: snapshot.expiresAt,
    periodStart: currentPeriod?.startTime ?? snapshot.periodStart ?? null,
    periodEnd: currentPeriod?.endTime ?? snapshot.periodEnd ?? null,
    temperature: currentPeriod?.temperature ?? snapshot.temperature ?? null,
    temperatureUnit:
      currentPeriod?.temperatureUnit ?? snapshot.temperatureUnit ?? null,
    precipitationProbability:
      currentPeriod?.probabilityOfPrecipitation ??
      snapshot.precipitationProbability ??
      null,
    isDaytime: currentPeriod?.isDaytime ?? snapshot.isDaytime ?? null,
    shortForecast: currentPeriod?.shortForecast ?? snapshot.shortForecast ?? null
  };
};

export const buildWeatherOverview = async (
  snapshot: WeatherForecastSnapshotAttributes,
  start?: Date,
  end?: Date
): Promise<WeatherOverviewPayload> => {
  const { periods, currentPeriod } = getSnapshotPeriodsAndCurrent(snapshot);

  const match: {
    office: string;
    gridX: number;
    gridY: number;
    periodStart?: { $gte?: Date; $lte?: Date };
  } = {
    office: WEATHER_OFFICE,
    gridX: WEATHER_GRID_X,
    gridY: WEATHER_GRID_Y
  };

  if (start || end) {
    const periodStart: { $gte?: Date; $lte?: Date } = {};
    if (start) {
      periodStart.$gte = start;
    }
    if (end) {
      periodStart.$lte = end;
    }
    match.periodStart = periodStart;
  }

  const historyQuery = PrecipitationHistory.find(match).sort({
    periodStart: 1
  });

  // default to future outlooks if no filter provided
  if (!start && !end) {
    historyQuery.where({ periodStart: { $gte: new Date() } });
  }

  const historyEntries = await historyQuery.lean();
  const currentConditions: WeatherForecastSnapshotAttributes = {
    ...snapshot,
    periodStart: currentPeriod?.startTime ?? snapshot.periodStart ?? null,
    periodEnd: currentPeriod?.endTime ?? snapshot.periodEnd ?? null,
    temperature: currentPeriod?.temperature ?? snapshot.temperature ?? null,
    temperatureUnit:
      currentPeriod?.temperatureUnit ?? snapshot.temperatureUnit ?? null,
    precipitationProbability:
      currentPeriod?.probabilityOfPrecipitation ??
      snapshot.precipitationProbability ??
      null,
    isDaytime: currentPeriod?.isDaytime ?? snapshot.isDaytime ?? null,
    shortForecast: currentPeriod?.shortForecast ?? snapshot.shortForecast ?? null,
    periods: toSnapshotPeriods(periods)
  };

  return {
    ...mapSnapshotToCurrentConditions(currentConditions),
    precipitationOutlook: historyEntries.map((entry) => ({
      periodStart: entry.periodStart,
      probability: entry.probability
    }))
  };
};

const clearForecastPeriodTimer = () => {
  if (!periodChangeTimeout) {
    return;
  }
  clearTimeout(periodChangeTimeout);
  periodChangeTimeout = null;
};

export const scheduleForecastPeriodPush = async (
  snapshot?: WeatherForecastSnapshotAttributes
) => {
  clearForecastPeriodTimer();

  let latestSnapshot = snapshot;
  if (!latestSnapshot) {
    try {
      latestSnapshot = await ensureForecastSnapshot();
    } catch (error) {
      console.error("Failed to load forecast snapshot for scheduling:", error);
      return;
    }
  }

  const { periods } = getSnapshotPeriodsAndCurrent(latestSnapshot);
  const nextPeriodStart = findNextPeriodStart(periods);
  if (!nextPeriodStart) {
    return;
  }

  const delay = Math.max(nextPeriodStart - Date.now(), 1000);

  periodChangeTimeout = setTimeout(async () => {
    try {
      const snapshotForPush = await ensureForecastSnapshot();
      const payload = await buildWeatherOverview(snapshotForPush);
      emitRealtimeEvent({
        type: "forecast:new",
        payload
      });
    } catch (error) {
      console.error("Failed to broadcast forecast period change:", error);
    } finally {
      periodChangeTimeout = null;
      void scheduleForecastPeriodPush().catch((scheduleError) =>
        console.error("Failed to reschedule forecast period change:", scheduleError)
      );
    }
  }, delay);

  periodChangeTimeout.unref?.();
};

export const getCurrentWeatherConditions = async (): Promise<CurrentWeatherConditions> => {
  const snapshot = await ensureForecastSnapshot();
  return mapSnapshotToCurrentConditions(snapshot);
};

let refreshIntervalHandle: NodeJS.Timeout | null = null;

export const startForecastAutoRefresh = () => {
  if (refreshIntervalHandle || WEATHER_AUTO_REFRESH_MS <= 0) {
    return;
  }

  const triggerRefresh = () => {
    void ensureForecastSnapshot().catch((error) => {
      console.error("Failed to auto-refresh forecast:", error);
    });
  };

  refreshIntervalHandle = setInterval(triggerRefresh, WEATHER_AUTO_REFRESH_MS);
  refreshIntervalHandle.unref?.();

  triggerRefresh();
};

export const stopForecastAutoRefresh = () => {
  if (refreshIntervalHandle) {
    clearInterval(refreshIntervalHandle);
    refreshIntervalHandle = null;
  }
  clearForecastPeriodTimer();
};
