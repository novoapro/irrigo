const parseNumericEnv = (
  value: string | undefined,
  fallback: number,
  minimum?: number
) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (minimum !== undefined && parsed < minimum) {
    return fallback;
  }
  return parsed;
};

export const WEATHER_API_BASE =
  process.env.WEATHER_API_BASE ?? "https://api.weather.gov";
export const WEATHER_OFFICE = process.env.WEATHER_OFFICE ?? "TBW";
export const WEATHER_GRID_X = parseNumericEnv(
  process.env.WEATHER_GRID_X,
  68
);
export const WEATHER_GRID_Y = parseNumericEnv(
  process.env.WEATHER_GRID_Y,
  109
);
export const WEATHER_LOCATION_NAME =
  process.env.WEATHER_LOCATION_NAME ?? "Tampa, FL";
export const WEATHER_USER_AGENT =
  process.env.WEATHER_USER_AGENT ??
  "MyLawnMonitor/1.0 (contact: example@example.com)";

export const WEATHER_FORECAST_TTL_MINUTES = parseNumericEnv(
  process.env.WEATHER_FORECAST_TTL_MINUTES,
  60,
  5
);
export const WEATHER_FORECAST_TTL_MS =
  WEATHER_FORECAST_TTL_MINUTES * 60 * 1000;

export const WEATHER_AUTO_REFRESH_MINUTES = parseNumericEnv(
  process.env.WEATHER_FORECAST_REFRESH_MINUTES,
  1440,
  0
);
export const WEATHER_AUTO_REFRESH_MS =
  WEATHER_AUTO_REFRESH_MINUTES > 0
    ? WEATHER_AUTO_REFRESH_MINUTES * 60 * 1000
    : 0;

export const WEATHER_FORECAST_REFRESH_THRESHOLD_MINUTES = parseNumericEnv(
  process.env.WEATHER_FORECAST_REFRESH_THRESHOLD_MINUTES,
  Math.min(15, WEATHER_FORECAST_TTL_MINUTES / 2),
  1
);
export const WEATHER_FORECAST_REFRESH_THRESHOLD_MS =
  WEATHER_FORECAST_REFRESH_THRESHOLD_MINUTES * 60 * 1000;

export const WEATHER_PRECIP_RETENTION_DAYS = parseNumericEnv(
  process.env.WEATHER_PRECIP_RETENTION_DAYS,
  90,
  1
);
export const WEATHER_PRECIP_RETENTION_SECONDS =
  WEATHER_PRECIP_RETENTION_DAYS * 24 * 60 * 60;
