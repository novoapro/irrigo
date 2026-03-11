import {
  safeDate,
  convertPeriod,
  findCurrentPeriod,
  findNextPeriodStart,
  type WeatherGovForecastPeriod,
  type ParsedForecastPeriod
} from "../weatherForecastService";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePeriod = (
  startISO: string,
  endISO: string,
  overrides: Partial<WeatherGovForecastPeriod> = {}
): WeatherGovForecastPeriod => ({
  startTime: startISO,
  endTime: endISO,
  temperature: 72,
  temperatureUnit: "F",
  isDaytime: true,
  probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: 10 },
  shortForecast: "Mostly Sunny",
  ...overrides
});

const makeParsed = (
  startISO: string,
  endISO: string,
  overrides: Partial<ParsedForecastPeriod> = {}
): ParsedForecastPeriod => ({
  startTime: new Date(startISO),
  endTime: new Date(endISO),
  temperature: 72,
  temperatureUnit: "F",
  isDaytime: true,
  probabilityOfPrecipitation: 10,
  shortForecast: "Mostly Sunny",
  ...overrides
});

// ---------------------------------------------------------------------------
// safeDate
// ---------------------------------------------------------------------------

describe("safeDate", () => {
  it("returns a valid Date for a well-formed ISO string", () => {
    const result = safeDate("2025-06-15T14:00:00.000Z");
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(new Date("2025-06-15T14:00:00.000Z").getTime());
  });

  it("returns the same Date when passed a Date instance", () => {
    const input = new Date("2025-01-01T00:00:00.000Z");
    const result = safeDate(input);
    expect(result).toBe(input);
  });

  it("returns a fresh Date (approx. now) for null", () => {
    const before = Date.now();
    const result = safeDate(null);
    const after  = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });

  it("returns a fresh Date (approx. now) for undefined", () => {
    const before = Date.now();
    const result = safeDate(undefined);
    const after  = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });

  it("returns a fresh Date (approx. now) for an invalid date string", () => {
    const before = Date.now();
    const result = safeDate("not-a-date");
    const after  = Date.now();
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// convertPeriod
// ---------------------------------------------------------------------------

describe("convertPeriod", () => {
  it("converts all fields from the NWS API shape to the internal shape", () => {
    const raw = makePeriod("2025-06-15T14:00:00+00:00", "2025-06-15T15:00:00+00:00", {
      temperature: 85,
      temperatureUnit: "F",
      isDaytime: true,
      probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: 20 },
      shortForecast: "Partly Cloudy"
    });
    const result = convertPeriod(raw);

    expect(result.startTime).toBeInstanceOf(Date);
    expect(result.endTime).toBeInstanceOf(Date);
    expect(result.temperature).toBe(85);
    expect(result.temperatureUnit).toBe("F");
    expect(result.isDaytime).toBe(true);
    expect(result.probabilityOfPrecipitation).toBe(20);
    expect(result.shortForecast).toBe("Partly Cloudy");
  });

  it("falls back to null when probabilityOfPrecipitation value is null", () => {
    const raw = makePeriod("2025-06-15T14:00:00+00:00", "2025-06-15T15:00:00+00:00", {
      probabilityOfPrecipitation: { unitCode: "wmoUnit:percent", value: null }
    });
    expect(convertPeriod(raw).probabilityOfPrecipitation).toBeNull();
  });

  it("falls back to null when shortForecast is null", () => {
    const raw = makePeriod("2025-06-15T14:00:00+00:00", "2025-06-15T15:00:00+00:00", {
      shortForecast: null
    });
    expect(convertPeriod(raw).shortForecast).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findCurrentPeriod
// ---------------------------------------------------------------------------

describe("findCurrentPeriod", () => {
  const periods: ParsedForecastPeriod[] = [
    makeParsed("2025-06-15T10:00:00.000Z", "2025-06-15T11:00:00.000Z"),
    makeParsed("2025-06-15T11:00:00.000Z", "2025-06-15T12:00:00.000Z"),
    makeParsed("2025-06-15T12:00:00.000Z", "2025-06-15T13:00:00.000Z")
  ];

  it("returns null for an empty periods array", () => {
    expect(findCurrentPeriod([], Date.now())).toBeNull();
  });

  it("returns the period whose window contains nowMs", () => {
    const nowMs = new Date("2025-06-15T11:30:00.000Z").getTime();
    const result = findCurrentPeriod(periods, nowMs);
    expect(result?.startTime.toISOString()).toBe("2025-06-15T11:00:00.000Z");
  });

  it("matches a period whose startTime equals nowMs (inclusive start)", () => {
    const nowMs = new Date("2025-06-15T12:00:00.000Z").getTime();
    const result = findCurrentPeriod(periods, nowMs);
    expect(result?.startTime.toISOString()).toBe("2025-06-15T12:00:00.000Z");
  });

  it("falls back to the first period when nowMs is before all periods start", () => {
    const nowMs = new Date("2025-06-15T09:00:00.000Z").getTime(); // before all periods
    const result = findCurrentPeriod(periods, nowMs);
    // find() returns undefined → falls back to periods[0]
    expect(result?.startTime.toISOString()).toBe("2025-06-15T10:00:00.000Z");
  });

  it("returns the last period when nowMs is within it", () => {
    const nowMs = new Date("2025-06-15T12:30:00.000Z").getTime();
    const result = findCurrentPeriod(periods, nowMs);
    expect(result?.startTime.toISOString()).toBe("2025-06-15T12:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// findNextPeriodStart
// ---------------------------------------------------------------------------

describe("findNextPeriodStart", () => {
  const periods: ParsedForecastPeriod[] = [
    makeParsed("2025-06-15T10:00:00.000Z", "2025-06-15T11:00:00.000Z"),
    makeParsed("2025-06-15T11:00:00.000Z", "2025-06-15T12:00:00.000Z"),
    makeParsed("2025-06-15T12:00:00.000Z", "2025-06-15T13:00:00.000Z")
  ];

  it("returns null for an empty periods array", () => {
    expect(findNextPeriodStart([], Date.now())).toBeNull();
  });

  it("returns the start time of the nearest future period", () => {
    const nowMs = new Date("2025-06-15T10:30:00.000Z").getTime();
    const result = findNextPeriodStart(periods, nowMs);
    expect(result).toBe(new Date("2025-06-15T11:00:00.000Z").getTime());
  });

  it("returns null when all periods are in the past", () => {
    const nowMs = new Date("2025-06-15T14:00:00.000Z").getTime(); // after all periods
    expect(findNextPeriodStart(periods, nowMs)).toBeNull();
  });

  it("returns the first period start when nowMs is before all periods", () => {
    const nowMs = new Date("2025-06-15T09:00:00.000Z").getTime();
    const result = findNextPeriodStart(periods, nowMs);
    expect(result).toBe(new Date("2025-06-15T10:00:00.000Z").getTime());
  });
});
