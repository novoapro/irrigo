import { formatDurationLabel, formatRelativeTime } from "../../utils/date";
import React from "react";
import SystemStatusIcon from "../SystemStatusIcon";
import type { StatusPayload } from "../../types";

type IrrigationStatus = {
  zone: string | null;
  action: "on" | "off" | null;
};

interface GuardCardProps {
  guard: boolean;
  lastChangeAt: string | null;
  lastIrrigationChange: string | null;
  irrigation: IrrigationStatus | null;
  now: number;
}

export const GuardCard = ({
  guard,
  lastChangeAt,
  lastIrrigationChange,
  irrigation,
  now
}: GuardCardProps) => {
  const cardStateClass = irrigation?.action === "on"
    ? "guard-card--irrigating"
    : guard
      ? "guard-card--alert"
      : "guard-card--ok";
  const statusIconType = irrigation?.action === "on"
    ? "sprinkler"
    : guard
      ? "guard-on"
      : "guard-bypassed";

  const irrigationState = (() => {
    if (irrigation?.zone) {
      const isIrrigating = irrigation.action === "on";
      const statusChip: "status-chip--alert" | "status-chip--neutral" = isIrrigating
        ? "status-chip--alert"
        : "status-chip--neutral";
      const chipLabel: "Sprinklers ON" | "Idle" = isIrrigating ? "Sprinklers ON" : "Idle";
      return {
        title: "Irrigation activity",
        detail: (
          <>
            <span className="zone-pill">{irrigation.zone}</span>{" was "}
            {isIrrigating ? "activated" : "deactivated"}{" "}
            {formatRelativeTime(lastIrrigationChange)}
          </>
        ),
        statusChip,
        chipLabel
      };
    }
    return {
      title: "Idle",
      detail: "Waiting for first run",
      statusChip: "status-chip--neutral" as const,
      chipLabel: "Idle"
    };
  })();

  return (
    <article className={`guard-card ${cardStateClass}`}>
      <header className="guard-card-header">
        <div className="guard-header-body">
          <h3>System status</h3>
          <div className="guard-chips">
            <span className={`status-chip ${irrigationState.statusChip}`}>
              {irrigationState.chipLabel}
            </span>
            <span className={`status-chip ${guard ? "status-chip--alert" : "status-chip--positive"}`}>
              {guard ? "Guard on" : "Guard off"}
            </span>
          </div>
        </div>
        <div className="guard-main-icon" aria-hidden="true">
          <SystemStatusIcon
            className={`guard-irrigation-icon${(guard && irrigationState) ? " guard-irrigation-icon--alert" : ""}`}
            type={statusIconType}
          />
        </div>
      </header>
      <div className="guard-card-main">
        <div className="guard-main-content">
          <h2 className={`guard-main-title`}>{irrigation?.action === "on"
            ? `Irrigating ${irrigation.zone ?? "—"}`
            : guard
              ? "Holding irrigation"
              : "Ready to irrigate"}</h2>
          <p className="metric-hint">{irrigationState.detail}</p>
        </div>
      </div>
      <footer className="sensor-footer guard-footer">
        <div className="sensor-last-update">
          <span className="metric-title">Last Update</span>
          <span className="metric-subtitle">
            {formatRelativeTime(lastChangeAt)}
          </span>
        </div>
      </footer>
    </article>
  );
};

export const GuardStatus = ({ guard }: { guard: boolean }) => (
  <span className={`guard-indicator ${guard ? "guard-on" : "guard-off"}`}>
    <span className="status-dot" aria-hidden />
  </span>
);
