import type { HeartbeatAttributes } from "../models/Heartbeat";

export interface HeartbeatOverviewBreakdown {
  activeMs: number;
  inactiveMs: number;
}

export interface HeartbeatOverviewDaysBreakdown {
  positive: number;
  negative: number;
}

export interface HeartbeatOverviewPayload {
  guard: HeartbeatOverviewBreakdown;
  rainDays: HeartbeatOverviewDaysBreakdown;
  soilDays: HeartbeatOverviewDaysBreakdown;
  pressure: HeartbeatOverviewBreakdown;
  range: {
    start: string | null;
    end: string | null;
  };
}

const toTime = (value: Date | string): number => new Date(value).getTime();

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const accumulateIntervals = (
  samples: HeartbeatAttributes[],
  startTime: number,
  endTime: number,
  selector: (sample: HeartbeatAttributes) => boolean
) => {
  let positive = 0;
  let negative = 0;

  if (samples.length === 0 || endTime <= startTime) {
    return { positive, negative };
  }

  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    const currentStart = toTime(current.timestamp);
    const next = samples[index + 1];
    const intervalStart = clamp(currentStart, startTime, endTime);
    const intervalEnd = clamp(
      next ? toTime(next.timestamp) : endTime,
      startTime,
      endTime
    );

    if (intervalEnd <= intervalStart) {
      continue;
    }

    const duration = intervalEnd - intervalStart;
    if (selector(current)) {
      positive += duration;
    } else {
      negative += duration;
    }
  }

  return { positive, negative };
};

const getDayKey = (value: Date | string) =>
  new Date(value).toISOString().slice(0, 10);

export const buildHeartbeatOverview = (
  samples: HeartbeatAttributes[],
  rangeStart?: Date,
  rangeEnd?: Date
): HeartbeatOverviewPayload => {
  const chronological = [...samples].sort(
    (a, b) => toTime(a.timestamp) - toTime(b.timestamp)
  );

  const firstTimestamp = chronological[0]?.timestamp ?? null;
  const lastTimestamp = chronological[chronological.length - 1]?.timestamp ?? null;

  const fallbackStart = firstTimestamp ? new Date(firstTimestamp) : null;
  const fallbackEnd = lastTimestamp ? new Date(lastTimestamp) : null;

  const effectiveStart = rangeStart ?? fallbackStart;
  let effectiveEnd = rangeEnd ?? new Date();
  if (fallbackEnd && effectiveEnd < fallbackEnd) {
    effectiveEnd = fallbackEnd;
  }

  const startTime = effectiveStart ? effectiveStart.getTime() : NaN;
  const endTime = effectiveEnd ? effectiveEnd.getTime() : NaN;

  let guardPositive = 0;
  let guardNegative = 0;
  let pressurePositive = 0;
  let pressureNegative = 0;

  if (!Number.isNaN(startTime) && !Number.isNaN(endTime) && endTime > startTime) {
    const guardDurations = accumulateIntervals(
      chronological,
      startTime,
      endTime,
      (sample) => sample.guard
    );
    guardPositive = guardDurations.positive;
    guardNegative = guardDurations.negative;

    const pressureDurations = accumulateIntervals(
      chronological,
      startTime,
      endTime,
      (sample) => sample.sensors.waterPsi > sample.device.baselinePsi
    );
    pressurePositive = pressureDurations.positive;
    pressureNegative = pressureDurations.negative;
  }

  const daySummaries = new Map<
    string,
    {
      rainDetected: boolean;
      soilMoist: boolean;
    }
  >();

  chronological.forEach((sample) => {
    const day = getDayKey(sample.timestamp);
    const current = daySummaries.get(day) ?? {
      rainDetected: false,
      soilMoist: false
    };
    daySummaries.set(day, {
      rainDetected: current.rainDetected || sample.sensors.rain,
      soilMoist: current.soilMoist || sample.sensors.soil
    });
  });

  let rainyDays = 0;
  let dryDays = 0;
  let moistDays = 0;
  let aridDays = 0;

  daySummaries.forEach((summary) => {
    if (summary.rainDetected) {
      rainyDays += 1;
    } else {
      dryDays += 1;
    }

    if (summary.soilMoist) {
      moistDays += 1;
    } else {
      aridDays += 1;
    }
  });

  return {
    guard: {
      activeMs: guardPositive,
      inactiveMs: guardNegative
    },
    rainDays: {
      positive: rainyDays,
      negative: dryDays
    },
    soilDays: {
      positive: moistDays,
      negative: aridDays
    },
    pressure: {
      activeMs: pressurePositive,
      inactiveMs: pressureNegative
    },
    range: {
      start: effectiveStart ? effectiveStart.toISOString() : firstTimestamp ? new Date(firstTimestamp).toISOString() : null,
      end: effectiveEnd ? effectiveEnd.toISOString() : lastTimestamp ? new Date(lastTimestamp).toISOString() : null
    }
  };
};
