import React, { useMemo } from "react";
import type { IrrigationEvent } from "../types";
import { formatDurationLabel, formatElapsedSince, formatTimestampShort } from "../utils/date";
import IrrigationIcon from "./IrrigationIcon";

export const IrrigationWidget = ({
  events,
  isLoading,
  totalCount,
  error,
  baselinePsi
}: {
  events: IrrigationEvent[];
  isLoading: boolean;
  totalCount: number;
  error?: string | null;
  baselinePsi?: number | null;
}) => {
  const zoneSummaries = useMemo(() => {
    const now = Date.now();
    const sorted = [...events].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    const openByZone = new Map<string, IrrigationEvent>();
    const lastCycleByZone = new Map<string, { on: IrrigationEvent; off?: IrrigationEvent }>();

    sorted.forEach((event) => {
      const ts = new Date(event.createdAt).getTime();
      if (Number.isNaN(ts)) return;

      if (event.action === "on") {
        openByZone.set(event.zone, event);
        return;
      }

      const open = openByZone.get(event.zone);
      if (!open) {
        return;
      }

      lastCycleByZone.set(event.zone, { on: open, off: event });
      openByZone.delete(event.zone);
    });

    openByZone.forEach((onEvent, zone) => {
      lastCycleByZone.set(zone, { on: onEvent, off: undefined });
    });

    return Array.from(lastCycleByZone.entries())
      .map(([zone, { on, off }]) => {
        const startTime = new Date(on.createdAt).getTime();
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
      .sort((a, b) => {
        const aEnd = a.end ? new Date(a.end).getTime() : Date.now();
        const bEnd = b.end ? new Date(b.end).getTime() : Date.now();
        return bEnd - aEnd || a.zone.localeCompare(b.zone);
      });
  }, [events]);

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
                <span className="irrigation-zone-row__zone">{record.zone}</span>
                <span className="irrigation-zone-row__duration">
                 {record.isActive ? "Running " : "Ran "} for {formatDurationLabel(record.durationMs)} {formatElapsedSince(record.end) ?? "0" }
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
                  <span className="irrigation-zone-row__label">{record.isActive ? "To (ongoing)" : "To"}</span>
                  <span className="irrigation-zone-row__value">
                    {record.isActive || !record.end ? "Ongoing" : formatTimestampShort(record.end)}
                  </span>
                  {record.pressureOff !== null && (
                    <span className={getPressureClass(record.pressureOff)}>
                      {record.pressureOff.toFixed(1)} psi
                    </span>
                  )}
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
