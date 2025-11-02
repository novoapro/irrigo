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

export const HEARTBEAT_RETENTION_DAYS = parseNumericEnv(
  process.env.HEARTBEAT_RETENTION_DAYS,
  90,
  1
);

export const HEARTBEAT_RETENTION_SECONDS =
  HEARTBEAT_RETENTION_DAYS * 24 * 60 * 60;

export const PRECIPITATION_RETENTION_DAYS = parseNumericEnv(
  process.env.PRECIPITATION_RETENTION_DAYS,
  HEARTBEAT_RETENTION_DAYS,
  1
);

export const PRECIPITATION_RETENTION_SECONDS =
  PRECIPITATION_RETENTION_DAYS * 24 * 60 * 60;

export const IRRIGATION_RETENTION_DAYS = parseNumericEnv(
  process.env.IRRIGATION_RETENTION_DAYS,
  90,
  1
);

export const IRRIGATION_RETENTION_SECONDS =
  IRRIGATION_RETENTION_DAYS * 24 * 60 * 60;
