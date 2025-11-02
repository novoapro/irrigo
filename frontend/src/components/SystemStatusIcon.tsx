import sprinklerSvg from "../assets/sprinkler.svg?raw";
import guardOnSvg from "../assets/guard_on.svg?raw";
import guardBypassedSvg from "../assets/guard_bypassed.svg?raw";

type SystemStatusIconType = "sprinkler" | "guard-on" | "guard-bypassed";

const ICON_MAP: Record<SystemStatusIconType, string> = {
  sprinkler: sprinklerSvg,
  "guard-on": guardOnSvg,
  "guard-bypassed": guardBypassedSvg
};

const enhanceSvgMarkup = (svgMarkup: string) =>
  svgMarkup.replace("<svg", '<svg fill="currentColor"');

const SystemStatusIcon = ({
  type,
  className
}: {
  type: SystemStatusIconType;
  className?: string;
}) => (
  <span
    className={`system-status-icon${className ? ` ${className}` : ""}`}
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: enhanceSvgMarkup(ICON_MAP[type]) }}
  />
);

export default SystemStatusIcon;
