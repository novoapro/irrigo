import type { ReactNode } from "react";
import { format, parseISO } from "date-fns";

import clearDaySvg from "@weather/clear-day.svg?raw";
import clearNightSvg from "@weather/clear-night.svg?raw";
import coldSvg from "@weather/cold.svg?raw";
import heavyRainSvg from "@weather/heavy-rain.svg?raw";
import hotSvg from "@weather/hot.svg?raw";
import huricaneSvg from "@weather/huricane.svg?raw";
import mostlyCloudyDaySvg from "@weather/mostly-cloudy-day.svg?raw";
import mostlyCloudyNightSvg from "@weather/mostly-cloudy-night.svg?raw";
import mostlyCloudySvg from "@weather/mostly-cloudy.svg?raw";
import partiallyCloudyDaySvg from "@weather/partially-cloudy-day.svg?raw";
import partiallyCloudyNightSvg from "@weather/partially-cloudy-night.svg?raw";
import partiallyCloudySvg from "@weather/partially-cloudy.svg?raw";
import rainDaySvg from "@weather/rain-day.svg?raw";
import rainNightSvg from "@weather/rain-night.svg?raw";
import rainIndicatorSvg from "@weather/rain-indicator.svg?raw";
import severeStormSvg from "@weather/severe-storm.svg?raw";
import showersDaySvg from "@weather/showers-day.svg?raw";
import showersNightSvg from "@weather/showers-night.svg?raw";
import showersSvg from "@weather/showers.svg?raw";
import snowSvg from "@weather/snow.svg?raw";
import stormSvg from "@weather/storm.svg?raw";
import tornadoSvg from "@weather/tornado.svg?raw";
import windySvg from "@weather/windy.svg?raw";
import fogSvg from "@weather/fog.svg?raw";

const normalizeForecastLabel = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();

export type ForecastCategory =
  | "clear"
  | "partly"
  | "cloudy"
  | "rain"
  | "showers"
  | "heavyRain"
  | "thunder"
  | "severeStorm"
  | "snow"
  | "fog"
  | "wind"
  | "hot"
  | "cold"
  | "mixed"
  | "tornado"
  | "hurricane";

type Variant = "day" | "night";

type IconSet = {
  day: string;
  night: string;
};

type IconBackground = "dark" | "light";

const ICON_TINTS: Record<IconBackground, string> = {
  dark: "#E3ECFF",
  light: "#1B3A8A"
};

const ICON_BASE_COLOR_REGEX = /#4469E4/gi;

const ICON_SVG_MAP: Record<ForecastCategory, IconSet> = {
  clear: { day: clearDaySvg, night: clearNightSvg },
  partly: { day: partiallyCloudyDaySvg, night: partiallyCloudyNightSvg },
  cloudy: { day: mostlyCloudyDaySvg, night: mostlyCloudyNightSvg },
  rain: { day: rainDaySvg, night: rainNightSvg },
  showers: { day: showersDaySvg, night: showersNightSvg },
  heavyRain: { day: heavyRainSvg, night: heavyRainSvg },
  thunder: { day: stormSvg, night: stormSvg },
  severeStorm: { day: severeStormSvg, night: severeStormSvg },
  snow: { day: snowSvg, night: snowSvg },
  fog: { day: fogSvg, night: fogSvg },
  wind: { day: windySvg, night: windySvg },
  hot: { day: hotSvg, night: hotSvg },
  cold: { day: coldSvg, night: coldSvg },
  mixed: { day: snowSvg, night: snowSvg },
  tornado: { day: tornadoSvg, night: tornadoSvg },
  hurricane: { day: huricaneSvg, night: huricaneSvg }
};

const tintSvgForBackground = (svgMarkup: string, background: IconBackground) =>
  svgMarkup.replace(ICON_BASE_COLOR_REGEX, ICON_TINTS[background]);

const setSvgFillColor = (svgMarkup: string, fillColor: string) =>
  svgMarkup.replace(/<svg([^>]*)>/i, (match, attrs) => {
    if (/fill="/i.test(attrs)) {
      return `<svg${attrs.replace(/fill="[^"]*"/i, `fill="${fillColor}"`)}>`;
    }
    return `<svg${attrs} fill="${fillColor}">`;
  });

export const getRainIndicatorIcon = (background: IconBackground = "dark"): ReactNode => {
  const tintedMarkup = setSvgFillColor(rainIndicatorSvg, ICON_TINTS[background]);
  return (
    <span
      className="rain-indicator-icon"
      dangerouslySetInnerHTML={{ __html: tintedMarkup }}
    />
  );
};

const CONDITION_CATEGORY_MAP: Record<string, ForecastCategory> = {
  "severe storm": "severeStorm",
  "showers storms": "thunder",
  "thunder storm": "thunder",
  "heavy rain": "heavyRain",
  "rain sleet": "mixed",
  "frzgrn snow": "mixed",
  "chance snowrain": "mixed",
  "rain and snow": "mixed",
  "rain or snow": "mixed",
  "freezing rain": "rain",
  "rain likely": "rain",
  "snow showers": "snow",
  "showers likely": "showers",
  "chance showers": "showers",
  "isolated showers": "showers",
  "scattered showers": "showers",
  "chance rain": "rain",
  rain: "rain",
  mix: "mixed",
  sleet: "mixed",
  snow: "snow",
  "fog am": "fog",
  "fog late": "fog",
  fog: "fog",
  tornado: "tornado",
  hurricane: "hurricane",
  "tropical storm": "hurricane",
  "very cold": "cold",
  "very hot": "hot",
  hot: "hot",
  overcast: "cloudy",
  "mostly cloudy": "cloudy",
  "partly cloudy": "partly",
  cloudy: "cloudy",
  "partly sunny": "partly",
  "mostly sunny": "clear",
  "mostly clear": "clear",
  sunny: "clear",
  clear: "clear",
  fair: "clear",
  "variable clouds": "cloudy",
  "partly sunny and windy": "partly",
  "mostly sunny and windy": "clear",
  "partly sunny and breezy": "partly",
  "mostly sunny and breezy": "clear",
  cloud: "cloudy"
};

const FORECAST_CATEGORY_FALLBACKS: Array<{ pattern: RegExp; category: ForecastCategory }> = [
  { pattern: /tornado/, category: "tornado" },
  { pattern: /hurricane|tropical/, category: "hurricane" },
  { pattern: /severe/, category: "severeStorm" },
  { pattern: /thunder|storm/, category: "thunder" },
  { pattern: /heavy rain/, category: "heavyRain" },
  { pattern: /shower/, category: "showers" },
  { pattern: /freezing|sleet|snow|mix|ice/, category: "mixed" },
  { pattern: /rain/, category: "rain" },
  { pattern: /fog|haze|dust|smoke/, category: "fog" },
  { pattern: /wind|breez/, category: "wind" },
  { pattern: /chill|cold|frigid/, category: "cold" },
  { pattern: /hot|heat/, category: "hot" },
  { pattern: /cloud|overcast/, category: "cloudy" },
  { pattern: /sunny|clear|fair/, category: "clear" }
];

const renderSvgIcon = (
  variant: Variant,
  category: ForecastCategory,
  background: IconBackground
): ReactNode => {
  const icons = ICON_SVG_MAP[category] ?? ICON_SVG_MAP.clear;
  const svgMarkup = variant === "day" ? icons.day : icons.night;
  const tintedMarkup = tintSvgForBackground(svgMarkup, background);
  return (
    <span
      className={`forecast-weather-icon forecast-weather-icon--${category}`}
      dangerouslySetInnerHTML={{ __html: tintedMarkup }}
    />
  );
};

interface ForecastIconOptions {
  background?: IconBackground;
}

/**
 * Pure classification function: resolves a raw NWS shortForecast string to a
 * ForecastCategory without rendering any React.  Useful for testing and for
 * callers that only need the category key.
 */
export const classifyForecast = (shortForecast: string | null | undefined): ForecastCategory => {
  if (!shortForecast) return "clear";
  const normalized = normalizeForecastLabel(shortForecast);
  if (normalized) {
    const direct = CONDITION_CATEGORY_MAP[normalized];
    if (direct) return direct;
    const fallback = FORECAST_CATEGORY_FALLBACKS.find(({ pattern }) => pattern.test(normalized));
    if (fallback) return fallback.category;
  }
  return "clear";
};

export const getForecastIcon = (
  isDaytime?: boolean | null,
  shortForecast?: string | null,
  options?: ForecastIconOptions
): ReactNode => {
  const variant: Variant = isDaytime === false ? "night" : "day";
  const background: IconBackground = options?.background ?? "dark";
  if (!shortForecast) {
    return renderSvgIcon(variant, "clear", background);
  }

  const normalized = normalizeForecastLabel(shortForecast);
  if (normalized) {
    const directCategory = CONDITION_CATEGORY_MAP[normalized];
    if (directCategory) {
      return renderSvgIcon(variant, directCategory, background);
    }
    const fallback = FORECAST_CATEGORY_FALLBACKS.find(({ pattern }) => pattern.test(normalized));
    if (fallback) {
      return renderSvgIcon(variant, fallback.category, background);
    }
  }

  return renderSvgIcon(variant, "clear", background);
};

export const formatWeatherWindow = (start?: string | null, end?: string | null) => {
  if (start && end) {
    return `${format(parseISO(start), "h a")} – ${format(parseISO(end), "h a")}`;
  }
  if (start) {
    return `From ${format(parseISO(start), "MMM d, h a")}`;
  }
  if (end) {
    return `Until ${format(parseISO(end), "MMM d, h a")}`;
  }
  return "No active forecast window";
};
