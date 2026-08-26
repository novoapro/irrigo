import { format, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";

const formatHour12 = (hour: number): string => {
  const period = hour < 12 ? "AM" : "PM";
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${display}:00 ${period}`;
};

export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: formatHour12(i),
}));

/** Full date-time, e.g. `08/22/25 07:43 PM`. Used in headers and detail rows. */
export const formatTimestamp = (value: string) =>
  format(parseISO(value), "MM/d/yy hh:mm a");

/**
 * Compact date-time for dense rows (zone cards, irrigation history), e.g.
 * `Aug 22, 7:43 PM` — drops the year and the leading hour zero to save space.
 */
export const formatTimestampShort = (value: string) =>
  format(parseISO(value), "MMM d, h:mm a");

export const formatHourLabel = (value: string) =>
  format(parseISO(value), "MMM d, h a");

export const formatDurationLabel = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  const minutes = ms / 60000;
  if (minutes >= 1440) {
    const days = minutes / 1440;
    return `${days >= 10 ? Math.round(days) : days.toFixed(1)} d`;
  }
  if (minutes >= 180) {
    // 3h+ : whole hours once we pass 10h, one decimal below that.
    const hours = minutes / 60;
    return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} h`;
  }
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${hours.toFixed(1)} h`;
  }
  return `${Math.max(1, Math.round(minutes))} min`;
};

export const formatCountLabel = (value: number, unitLabel: string) => {
  const rounded = Math.max(0, Math.round(value));
  const suffix = rounded === 1 ? unitLabel : `${unitLabel}s`;
  return `${rounded} ${suffix}`;
};

export const toQueryDateTime = (date: Date | null) => {
  if (!date) {
    return undefined;
  }
  return new Date(date).toISOString();
};

export const formatRelativeTime = (value: string | null) => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (!isValid(date)) {
    return "—";
  }
  return formatDistanceToNowStrict(date, { addSuffix: true });
};

export const formatElapsedDuration = (value: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (!isValid(date)) return "—";
  return formatDistanceToNowStrict(date);
};

// Returns a compact elapsed label (e.g., "5m", "3h", "2d") for an ISO timestamp.
export const formatElapsedSince = (iso: string | null | undefined) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (!isValid(date)) return "";
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 0) return "";

  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 60) {
    return `${minutes || 1} min ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};
