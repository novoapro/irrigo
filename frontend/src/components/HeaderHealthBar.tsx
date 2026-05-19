import type { IntegrationHealth, HealthState } from "../hooks/useIntegrationHealth";

const stateClass = (state: HealthState) => {
  switch (state) {
    case "ok": return "health-dot--ok";
    case "warning": return "health-dot--warning";
    case "error": return "health-dot--error";
    case "loading": return "health-dot--loading";
    case "off": return "health-dot--off";
    default: return "health-dot--off";
  }
};

const HealthIndicator = ({
  name,
  state,
  label
}: {
  name: string;
  state: HealthState;
  label: string;
}) => (
  <span className="health-indicator" title={`${name}: ${label}`}>
    <span className={`health-dot ${stateClass(state)}`} />
    <span className="health-name">{name}</span>
  </span>
);

const HeaderHealthBar = ({ health }: { health: IntegrationHealth }) => (
  <div className="header-health-bar">
    <HealthIndicator name="Server" state={health.server.state} label={health.server.label} />
    {health.controller.state !== "off" ? (
      <HealthIndicator name="Controller" state={health.controller.state} label={health.controller.label} />
    ) : null}
    {health.ai.state !== "off" ? (
      <HealthIndicator name="AI" state={health.ai.state} label={health.ai.label} />
    ) : null}
    <HealthIndicator name="Weather" state={health.weather.state} label={health.weather.label} />
  </div>
);

export default HeaderHealthBar;
