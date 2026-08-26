import type { ReactNode } from "react";
import type { StatusTone } from "../components/status/SensorWidgets";

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

/**
 * Everything the StatusPanel needs to render one sensor tile, bundled into a
 * single value.
 *
 * Lesson — "props that travel together become one object": the panel used to
 * take three loose props per sensor (`rainStatus` / `rainTone` / `rainActive`,
 * and the same triple for pressure and soil — nine flat props in all). Those
 * three are never meaningful apart: a status label always comes with the tone
 * that colours it and the flag saying whether the sensor is live. When several
 * props are always produced together, always passed together, and always read
 * together, that is the signal to promote them into one cohesive type. One
 * `SensorDescriptor` per sensor replaces the triple, so the panel's prop list
 * shrinks from nine to three and there is no way to pass a status without its
 * matching tone.
 */
export type SensorDescriptor = {
  /** Human-readable state, e.g. "Detected", "Dry", "No data", "Ignored". */
  status: string;
  /** Which colour treatment the tile uses for this state. */
  tone: StatusTone;
  /** Whether the sensor is connected/participating (drives the Active badge). */
  active: boolean;
};

/**
 * Derive a {@link SensorDescriptor} for a boolean sensor (rain, soil) from the
 * one shared decision tree.
 *
 * Lesson — "one decision tree, not four ternaries": the dashboard previously
 * spelled out this exact logic four separate times (a status ternary and a tone
 * ternary, each for rain and for soil), every copy three levels deep and
 * differing only in the labels. Duplicated branching is where bugs hide — fix
 * the tree in one copy and the other three silently drift. Here the tree lives
 * once and the only things that vary between sensors (the on/off wording) are
 * passed in as `labels`. The tone always follows the same state, so it is
 * decided here, never at the call site.
 *
 * The decision tree (top to bottom):
 *   1. sensor not connected           → "Ignored" / warning
 *   2. connected, but no reading yet   → "No data" / informative
 *   3. connected and the reading is on → labels.on / negative
 *   4. connected and the reading is off→ labels.off / positive
 *
 * @param connected Is the sensor in the connected-sensors set?
 * @param live      The reading from the live `status` payload, or `undefined`
 *                  when there is no live status. `false` is a real reading and
 *                  is kept (it is not treated as "missing").
 * @param snapshot  The reading from the last heartbeat snapshot, used as a
 *                  fallback only when `live` is absent.
 * @param labels    The on/off wording for this particular sensor.
 */
export const readSensor = (
  connected: boolean,
  live: boolean | undefined,
  snapshot: boolean | undefined,
  labels: { on: string; off: string }
): SensorDescriptor => {
  // A disconnected sensor is deliberately ignored by the controller.
  if (!connected) {
    return { status: "Ignored", tone: "warning", active: false };
  }

  // Prefer the live reading; fall back to the snapshot. `??` (not `||`) so a
  // genuine `false` reading is used rather than skipped as "missing".
  const reading = live ?? snapshot;

  // Connected but nothing has reported a value yet.
  if (reading === undefined) {
    return { status: "No data", tone: "informative", active: true };
  }

  return reading
    ? { status: labels.on, tone: "negative", active: true }
    : { status: labels.off, tone: "positive", active: true };
};
