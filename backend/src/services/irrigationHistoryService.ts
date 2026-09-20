import IrrigationEvent from "../models/IrrigationEvent";
import { getTimezone, getDayKeyInTimezone } from "./irrigationSettingsService";

// Execution-time guardrails derived from actual irrigation history. Both helpers read the
// same IrrigationEvent on/off stream the AI planner summarizes (aiSchedulingService.gatherData),
// so the caps the executor enforces are computed from the same source of truth the AI is
// advised with — the executor is the hard backstop, the prompt rules are the soft hint.

// Total minutes irrigated so far during the calendar day (in the settings timezone) that
// `now` falls in. Pairs each "on" event with the next "off" for the same zone; an "on"
// with no matching "off" (a run still in flight) is counted up to `now`.
export const getMinutesRunToday = async (now: Date): Promise<number> => {
  const tz = await getTimezone();
  const todayKey = getDayKeyInTimezone(now, tz);

  // Look back 24h+ to catch runs that started late "yesterday" but whose events we still
  // need; we filter to today's calendar day per-event below.
  const since = new Date(now.getTime() - 26 * 3600_000);
  const events = await IrrigationEvent.find({ createdAt: { $gte: since } })
    .sort({ createdAt: 1 })
    .lean();

  const openOnByZone = new Map<string, Date>();
  let totalMs = 0;

  const addSpan = (start: Date, end: Date) => {
    // Only count the portion of the span that lands in today's calendar day.
    if (getDayKeyInTimezone(start, tz) !== todayKey && getDayKeyInTimezone(end, tz) !== todayKey) return;
    totalMs += Math.max(0, end.getTime() - start.getTime());
  };

  for (const ev of events) {
    const at = ev.createdAt ? new Date(ev.createdAt) : null;
    if (!at) continue;
    if (ev.action === "on") {
      openOnByZone.set(ev.zone, at);
    } else if (ev.action === "off") {
      const onAt = openOnByZone.get(ev.zone);
      if (onAt) {
        addSpan(onAt, at);
        openOnByZone.delete(ev.zone);
      }
    }
  }

  // Any zone still "on" is counted up to now.
  for (const onAt of openOnByZone.values()) {
    addSpan(onAt, now);
  }

  return Math.round(totalMs / 60_000);
};

// Most recent time each of the given zones was turned on. Zones with no recorded run are
// absent from the map. Used to enforce the minimum rest interval between runs.
export const getLastRunByZone = async (zoneIds: string[]): Promise<Map<string, Date>> => {
  const result = new Map<string, Date>();
  if (zoneIds.length === 0) return result;

  const events = await IrrigationEvent.find({ zone: { $in: zoneIds }, action: "on" })
    .sort({ createdAt: -1 })
    .lean();

  for (const ev of events) {
    if (!result.has(ev.zone) && ev.createdAt) {
      result.set(ev.zone, new Date(ev.createdAt));
    }
  }
  return result;
};
