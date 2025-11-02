import type { ReactNode } from "react";

import rainSensorSvg from "../assets/sensors/rain-sensor.svg?raw";
import soilSensorSvg from "../assets/sensors/soil-sensor.svg?raw";
import waterPressureSensorSvg from "../assets/sensors/water-pressure-sensor.svg?raw";

const SENSOR_SVG_MAP = {
  pressure: waterPressureSensorSvg,
  rain: rainSensorSvg,
  soil: soilSensorSvg
};

export type SensorIconType = keyof typeof SENSOR_SVG_MAP;

const enhanceSvgMarkup = (svgMarkup: string) =>
  svgMarkup.replace("<svg", '<svg fill="currentColor"');

export const getSensorIcon = (
  type: SensorIconType,
  className?: string
): ReactNode => (
  <span
    className={`sensor-icon-svg${className ? ` ${className}` : ""}`}
    aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: enhanceSvgMarkup(SENSOR_SVG_MAP[type]) }}
  />
);
