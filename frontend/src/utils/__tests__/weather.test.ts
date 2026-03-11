import { describe, it, expect } from "vitest";
import { classifyForecast, formatWeatherWindow } from "../weather";

// ---------------------------------------------------------------------------
// classifyForecast
// ---------------------------------------------------------------------------
// Tests the NWS shortForecast → ForecastCategory resolution pipeline:
//   1. null / empty                 → "clear"
//   2. Exact match in CONDITION_CATEGORY_MAP (after normalisation)
//   3. Regex fallback in FORECAST_CATEGORY_FALLBACKS
//   4. Unrecognised label           → "clear"

describe("classifyForecast", () => {
  // Null / empty
  it("returns 'clear' for null", () => {
    expect(classifyForecast(null)).toBe("clear");
  });

  it("returns 'clear' for undefined", () => {
    expect(classifyForecast(undefined)).toBe("clear");
  });

  it("returns 'clear' for an empty string", () => {
    expect(classifyForecast("")).toBe("clear");
  });

  // Direct map matches (normalised → exact key)
  it("returns 'clear' for 'Sunny'", () => {
    expect(classifyForecast("Sunny")).toBe("clear");
  });

  it("returns 'clear' for 'Mostly Sunny'", () => {
    expect(classifyForecast("Mostly Sunny")).toBe("clear");
  });

  it("returns 'clear' for 'Mostly Clear'", () => {
    expect(classifyForecast("Mostly Clear")).toBe("clear");
  });

  it("returns 'partly' for 'Partly Cloudy'", () => {
    expect(classifyForecast("Partly Cloudy")).toBe("partly");
  });

  it("returns 'partly' for 'Partly Sunny'", () => {
    expect(classifyForecast("Partly Sunny")).toBe("partly");
  });

  it("returns 'cloudy' for 'Mostly Cloudy'", () => {
    expect(classifyForecast("Mostly Cloudy")).toBe("cloudy");
  });

  it("returns 'cloudy' for 'Overcast'", () => {
    expect(classifyForecast("Overcast")).toBe("cloudy");
  });

  it("returns 'rain' for 'Rain'", () => {
    expect(classifyForecast("Rain")).toBe("rain");
  });

  it("returns 'rain' for 'Rain Likely'", () => {
    expect(classifyForecast("Rain Likely")).toBe("rain");
  });

  it("returns 'rain' for 'Chance Rain'", () => {
    expect(classifyForecast("Chance Rain")).toBe("rain");
  });

  it("returns 'showers' for 'Chance Showers'", () => {
    expect(classifyForecast("Chance Showers")).toBe("showers");
  });

  it("returns 'showers' for 'Scattered Showers'", () => {
    expect(classifyForecast("Scattered Showers")).toBe("showers");
  });

  it("returns 'heavyRain' for 'Heavy Rain'", () => {
    expect(classifyForecast("Heavy Rain")).toBe("heavyRain");
  });

  it("returns 'snow' for 'Snow'", () => {
    expect(classifyForecast("Snow")).toBe("snow");
  });

  it("returns 'snow' for 'Snow Showers'", () => {
    expect(classifyForecast("Snow Showers")).toBe("snow");
  });

  it("returns 'mixed' for 'Rain and Snow'", () => {
    expect(classifyForecast("Rain and Snow")).toBe("mixed");
  });

  it("returns 'fog' for 'Fog'", () => {
    expect(classifyForecast("Fog")).toBe("fog");
  });

  it("returns 'tornado' for 'Tornado'", () => {
    expect(classifyForecast("Tornado")).toBe("tornado");
  });

  it("returns 'hurricane' for 'Hurricane'", () => {
    expect(classifyForecast("Hurricane")).toBe("hurricane");
  });

  it("returns 'hurricane' for 'Tropical Storm'", () => {
    expect(classifyForecast("Tropical Storm")).toBe("hurricane");
  });

  it("returns 'thunder' for 'Showers and Thunderstorms' (direct map)", () => {
    expect(classifyForecast("Showers and Thunderstorms")).toBe("thunder");
  });

  // Regex fallback matches (no direct key, but pattern fires)
  it("returns 'thunder' for 'Isolated Thunderstorms' via regex fallback", () => {
    expect(classifyForecast("Isolated Thunderstorms")).toBe("thunder");
  });

  it("returns 'severeStorm' for 'Severe Thunderstorms' via regex fallback", () => {
    expect(classifyForecast("Severe Thunderstorms")).toBe("severeStorm");
  });

  it("returns 'mixed' for 'Freezing Drizzle' via regex fallback", () => {
    expect(classifyForecast("Freezing Drizzle")).toBe("mixed");
  });

  it("returns 'fog' for 'Patchy Haze' via regex fallback", () => {
    expect(classifyForecast("Patchy Haze")).toBe("fog");
  });

  it("returns 'wind' for 'Breezy' via regex fallback", () => {
    expect(classifyForecast("Breezy")).toBe("wind");
  });

  it("returns 'cold' for 'Frigid' via regex fallback", () => {
    expect(classifyForecast("Frigid")).toBe("cold");
  });

  it("returns 'hot' for 'Heat Advisory' via regex fallback", () => {
    expect(classifyForecast("Heat Advisory")).toBe("hot");
  });

  // Normalisation: punctuation and extra spaces are stripped
  it("strips punctuation before matching", () => {
    expect(classifyForecast("Sunny!")).toBe("clear");
    expect(classifyForecast("Rain...")).toBe("rain");
  });

  it("collapses multiple spaces", () => {
    expect(classifyForecast("Mostly   Cloudy")).toBe("cloudy");
  });

  // Unknown label → fallback to "clear"
  it("returns 'clear' for an entirely unrecognised label", () => {
    expect(classifyForecast("Xyzzy weather event")).toBe("clear");
  });
});

// ---------------------------------------------------------------------------
// formatWeatherWindow
// ---------------------------------------------------------------------------

describe("formatWeatherWindow", () => {
  // All tests use UTC ISO strings; TZ=UTC is set in src/test/setup.ts so
  // date-fns formats in UTC and results are deterministic.

  it("returns 'No active forecast window' when both arguments are nullish", () => {
    expect(formatWeatherWindow(null, null)).toBe("No active forecast window");
    expect(formatWeatherWindow(undefined, undefined)).toBe("No active forecast window");
    expect(formatWeatherWindow()).toBe("No active forecast window");
  });

  it("formats as 'H a – H a' when both start and end are provided", () => {
    const start = "2025-06-15T14:00:00.000Z"; // 2 PM UTC
    const end   = "2025-06-15T15:00:00.000Z"; // 3 PM UTC
    expect(formatWeatherWindow(start, end)).toBe("2 PM – 3 PM");
  });

  it("handles AM times correctly in the start+end format", () => {
    const start = "2025-06-15T09:00:00.000Z"; // 9 AM UTC
    const end   = "2025-06-15T10:00:00.000Z"; // 10 AM UTC
    expect(formatWeatherWindow(start, end)).toBe("9 AM – 10 AM");
  });

  it("formats 'From MMM d, H a' when only start is provided", () => {
    const start = "2025-06-15T14:00:00.000Z"; // Jun 15, 2 PM UTC
    expect(formatWeatherWindow(start, null)).toBe("From Jun 15, 2 PM");
  });

  it("formats 'Until MMM d, H a' when only end is provided", () => {
    const end = "2025-06-15T15:00:00.000Z"; // Jun 15, 3 PM UTC
    expect(formatWeatherWindow(null, end)).toBe("Until Jun 15, 3 PM");
  });

  it("formats null start with a valid end as 'Until …'", () => {
    const end = "2025-01-01T00:00:00.000Z"; // Jan 1, 12 AM UTC
    expect(formatWeatherWindow(undefined, end)).toBe("Until Jan 1, 12 AM");
  });
});
