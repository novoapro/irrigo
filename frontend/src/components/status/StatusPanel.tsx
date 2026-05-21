import type { ReactNode } from "react";
import type { Zone } from "../../types";
import type { StatusTone } from "./SensorWidgets";
import { formatElapsedDuration, formatRelativeTime } from "../../utils/date";
import { getSensorIcon } from "../../utils/sensors";
import SystemStatusIcon from "../SystemStatusIcon";

type IrrigationStatus = {
  zone: string | null;
  action: "on" | "off" | null;
};

interface StatusPanelProps {
  guard: boolean;
  irrigation: IrrigationStatus | null;
  lastIrrigationChange: string | null;
  pressureStatus: string;
  pressureTone: StatusTone;
  pressureDetail?: string;
  pressureActive: boolean;
  rainStatus: string;
  rainTone: StatusTone;
  rainActive: boolean;
  soilStatus: string;
  soilTone: StatusTone;
  soilActive: boolean;
  zones?: Zone[];
}

const toneColorClass = (tone: StatusTone) => `status-tile--${tone}`;

const StatusTile = ({
  label,
  value,
  tone = "informative",
  detail,
  icon,
  active
}: {
  label: string;
  value: string;
  tone?: StatusTone;
  detail?: string;
  icon?: ReactNode;
  active?: boolean;
}) => (
  <div className={`status-tile ${toneColorClass(tone)}`}>
    <div className="status-tile__header">
      {icon ? <span className="status-tile__icon">{icon}</span> : null}
      <span className="status-tile__label">{label}</span>
      {active !== undefined ? (
        <span className={`status-tile__badge ${active ? "status-tile__badge--on" : "status-tile__badge--off"}`}>
          {active ? "Active" : "Off"}
        </span>
      ) : null}
    </div>
    <span className="status-tile__value">{value}</span>
    {detail ? <span className="status-tile__detail">{detail}</span> : null}
  </div>
);

export const StatusPanel = ({
  guard,
  irrigation,
  lastIrrigationChange,
  pressureStatus,
  pressureTone,
  pressureDetail,
  pressureActive,
  rainStatus,
  rainTone,
  rainActive,
  soilStatus,
  soilTone,
  soilActive,
  zones
}: StatusPanelProps) => {
  const isIrrigating = irrigation?.action === "on";

  const resolveZoneName = (zoneId: string | null | undefined): string => {
    if (!zoneId) return "";
    const match = zones?.find((z) => z.zoneId === zoneId);
    return match?.name ?? zoneId;
  };

  const zoneName = resolveZoneName(irrigation?.zone);

  const systemState = isIrrigating
    ? `Irrigating ${zoneName}`
    : guard
      ? "Holding irrigation"
      : "Ready to irrigate";

  const statusIconType = isIrrigating
    ? "sprinkler" as const
    : guard
      ? "guard-on" as const
      : "guard-bypassed" as const;

  const panelTone = isIrrigating
    ? "status-panel--irrigating"
    : guard
      ? "status-panel--holding"
      : "status-panel--ready";

  const irrigationValue = isIrrigating
    ? `${zoneName || "—"} ON`
    : "Idle";

  const irrigationDetail = lastIrrigationChange
    ? (isIrrigating ? `Running for ${formatElapsedDuration(lastIrrigationChange)}` : formatRelativeTime(lastIrrigationChange))
    : "No activity";

  return (
    <section className={`status-panel ${panelTone}`}>
      <header className="status-panel__header">
        <div className="status-panel__header-left">
          <div className="status-panel__icon">
            <SystemStatusIcon type={statusIconType} />
          </div>
          <div className="status-panel__title-group">
            <h3 className="status-panel__title">{systemState}</h3>
            <div className="status-panel__chips">
              <span className={`status-chip ${guard ? "status-chip--alert" : "status-chip--positive"}`}>
                {guard ? "Guard on" : "Guard off"}
              </span>
              {isIrrigating ? (
                <span className="status-chip status-chip--alert">Sprinklers ON</span>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="status-panel__grid">
        <StatusTile
          label="Irrigation"
          value={irrigationValue}
          tone={isIrrigating ? "alert" : "neutral"}
          detail={irrigationDetail}
        />
        <StatusTile
          label="Pressure"
          icon={getSensorIcon("pressure", "sensor-icon--pressure")}
          value={pressureStatus}
          tone={pressureTone}
          detail={pressureDetail}
          active={pressureActive}
        />
        <StatusTile
          label="Rain"
          icon={getSensorIcon("rain", "sensor-icon--rain")}
          value={rainStatus}
          tone={rainTone}
          active={rainActive}
        />
        <StatusTile
          label="Soil"
          icon={getSensorIcon("soil", "sensor-icon--soil")}
          value={soilStatus}
          tone={soilTone}
          active={soilActive}
        />
      </div>
    </section>
  );
};
