/**
 * IrrigationWidget — "Irrigation Tracker" card showing the latest watering cycle
 * per zone.
 *
 * The interesting part is the derivation in `zoneSummaries`: the parent passes a
 * flat stream of raw on/off `events`, and this component reduces them into "the
 * most recent complete (or still-open) cycle for each zone". It does so by
 * sorting events chronologically and pairing each "on" with the next "off" for
 * the same zone; a zone with an unmatched "on" is treated as *currently running*
 * (its duration ticks up to `now`).
 *
 * React notes:
 *  - `useNow()` provides a live clock so an in-progress cycle's duration updates
 *    without an interval/setState effect.
 *  - `zoneSummaries` is a plain IIFE, not `useMemo`. The React Compiler memoizes
 *    it automatically from its inputs (`events` + `now`). Keeping `Date.now()`
 *    out of the body (using `now` instead) preserves purity so that memoization
 *    is valid.
 *
 * Key props: `events` (raw log), `isLoading` / `error`, `totalCount`,
 * `baselinePsi` (colors pressure chips low/ok), and `zones` (id -> name lookup).
 */
import type { IrrigationEvent, Zone } from "../types";
import { formatDurationLabel, formatElapsedSince, formatTimestampShort } from "../utils/date";
import { useNow } from "../hooks/useNow";
import IrrigationIcon from "./IrrigationIcon";

export const IrrigationWidget = ({
  events,
  isLoading,
  totalCount,
  error,
  baselinePsi,
  zones
}: {
  events: IrrigationEvent[];
  isLoading: boolean;
  totalCount: number;
  error?: string | null;
  baselinePsi?: number | null;
  zones?: Zone[];
}) => {
  // Live clock so ongoing-cycle durations tick, without an impure Date.now() in
  // the memo body (React Compiler purity rule).
  const now = useNow();
  // Plain derivation — the React Compiler memoizes it (on `events` + `now`).
  const zoneSummaries = (() => {
    // Process events oldest-first so each "off" pairs with the most recent "on".
    const sorted = [...events].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    // openByZone: zones with an "on" not yet closed by an "off".
    // lastCycleByZone: the latest cycle we've seen per zone (overwritten as newer
    // cycles arrive, so only the most recent survives).
    const openByZone = new Map<string, IrrigationEvent>();
    const lastCycleByZone = new Map<string, { on: IrrigationEvent; off?: IrrigationEvent }>();

    sorted.forEach((event) => {
      const ts = new Date(event.createdAt).getTime();
      if (Number.isNaN(ts)) return; // skip malformed timestamps

      if (event.action === "on") {
        openByZone.set(event.zone, event); // remember; wait for its "off"
        return;
      }

      // An "off" only counts if we have a matching open "on" for that zone.
      const open = openByZone.get(event.zone);
      if (!open) {
        return;
      }

      lastCycleByZone.set(event.zone, { on: open, off: event });
      openByZone.delete(event.zone);
    });

    // Any zone still "open" is currently irrigating — record it with no off.
    openByZone.forEach((onEvent, zone) => {
      lastCycleByZone.set(zone, { on: onEvent, off: undefined });
    });

    return Array.from(lastCycleByZone.entries())
      .map(([zone, { on, off }]) => {
        const startTime = new Date(on.createdAt).getTime();
        // Open cycle -> measure up to the live clock; closed -> to the off event.
        const endTime = off ? new Date(off.createdAt).getTime() : now;
        const duration = Math.max(0, endTime - startTime);

        return {
          zone,
          start: on.createdAt,
          end: off?.createdAt ?? null,
          durationMs: duration,
          isActive: !off,
          pressureOn: on.waterPressure ?? null,
          pressureOff: off?.waterPressure ?? null
        };
      })
      // Most recently finished (or active) first; ties broken by zone name.
      .sort((a, b) => {
        const aEnd = a.end ? new Date(a.end).getTime() : now;
        const bEnd = b.end ? new Date(b.end).getTime() : now;
        return bEnd - aEnd || a.zone.localeCompare(b.zone);
      });
  })();

  // Color a pressure reading: "low" when below baseline, "ok" otherwise, and no
  // chip class at all when we have no baseline to compare against.
  const getPressureClass = (value: number | null) => {
    if (value === null || baselinePsi === undefined || baselinePsi === null) {
      return "";
    }
    return value < baselinePsi ? "pressure-chip pressure-chip--low" : "pressure-chip pressure-chip--ok";
  };

  return (
    <article className="irrigation-widget">
      <header className="irrigation-widget__header">
        <div className="irrigation-widget__header-body">
          <h3>Irrigation Tracker</h3>
          <p className="muted">Latest cycle per zone</p>
        </div>
        <div className="irrigation-widget__icon" aria-hidden="true">
          <IrrigationIcon />
        </div>
      </header>

      {isLoading ? (
        <p className="muted">Loading irrigation data…</p>
      ) : error ? (
        <p className="muted">Unable to load irrigation events · {error}</p>
      ) : zoneSummaries.length === 0 ? (
        <p className="muted">No irrigation records yet.</p>
      ) : (
        <div className="irrigation-widget__list">
          {zoneSummaries.map((record) => (
            <div
              key={record.zone}
              className={`irrigation-zone-row${record.isActive ? " irrigation-zone-row--active" : ""}`}
            >
              <div className="irrigation-zone-row__main">
                <span className="irrigation-zone-row__zone">
                  {zones?.find((z) => z.zoneId === record.zone)?.name ?? record.zone}
                </span>
                <span className="irrigation-zone-row__duration">
                  {record.isActive
                    ? formatDurationLabel(record.durationMs)
                    : formatElapsedSince(record.end) ?? ""}
                </span>
              </div>
              <div className="irrigation-zone-row__meta">
                <div className="irrigation-zone-row__meta-item">
                  <span className="irrigation-zone-row__label">From</span>
                  <span className="irrigation-zone-row__value">{formatTimestampShort(record.start)}</span>
                  {record.pressureOn !== null && (
                    <span className={getPressureClass(record.pressureOn)}>
                      {record.pressureOn.toFixed(1)} psi
                    </span>
                  )}
                </div>
                <div className="irrigation-zone-row__meta-item">
                  <span className="irrigation-zone-row__label">{record.isActive ? "" : "To"}</span>
                  <span className="irrigation-zone-row__value">
                    {record.isActive || !record.end ? "" : formatTimestampShort(record.end)}
                  </span>

                  <div className="irrigation-metadata">
                    {record.pressureOff !== null && (
                      <span className={getPressureClass(record.pressureOff)}>
                        {record.pressureOff.toFixed(1)} psi
                      </span>
                    )}
                    <span className="duration-value">
                      {record.isActive || !record.end ? "" : formatDurationLabel(record.durationMs)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </article>
  );
};

export default IrrigationWidget;
