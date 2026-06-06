const getDatePartsInTimezone = (date: Date, tz: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";

  return {
    minute: get("minute"),
    hour: get("hour") === 24 ? 0 : get("hour"),
    dayOfMonth: get("day"),
    month: get("month"),
    year: get("year"),
    dayOfWeek: dayMap[weekdayStr] ?? 0
  };
};

export const cronMatchesNow = (cron: string, now: Date, tz: string): boolean => {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return false;

  const [minPart, hourPart, domPart, , dowPart] = parts;
  const dp = getDatePartsInTimezone(now, tz);

  if (minPart !== "*" && parseInt(minPart!, 10) !== dp.minute) return false;
  if (hourPart !== "*" && parseInt(hourPart!, 10) !== dp.hour) return false;

  if (domPart && domPart !== "*") {
    const stepMatch = domPart.match(/^\*\/(\d+)$/);
    if (stepMatch) {
      if (dp.dayOfMonth % parseInt(stepMatch[1]!, 10) !== 1) return false;
    }
  }

  if (dowPart && dowPart !== "*") {
    const dowValues = new Set<number>();
    for (const segment of dowPart.split(",")) {
      const rangeParts = segment.split("-");
      if (rangeParts.length === 2) {
        const start = parseInt(rangeParts[0]!, 10);
        const end = parseInt(rangeParts[1]!, 10);
        for (let i = start; i <= end; i++) dowValues.add(i);
      } else {
        dowValues.add(parseInt(segment, 10));
      }
    }
    if (!dowValues.has(dp.dayOfWeek)) return false;
  }

  return true;
};

export const getMinuteKeyInTimezone = (now: Date, tz: string): string => {
  const dp = getDatePartsInTimezone(now, tz);
  return `${dp.year}-${dp.month}-${dp.dayOfMonth}-${dp.hour}-${dp.minute}`;
};
