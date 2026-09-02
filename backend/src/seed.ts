import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

import Zone from "./models/Zone";
import IrrigationProgram from "./models/IrrigationProgram";
import Heartbeat from "./models/Heartbeat";
import ScheduleRun from "./models/ScheduleRun";
import ScheduleEntry from "./models/ScheduleEntry";
import IrrigationCommand from "./models/IrrigationCommand";
import IrrigationEvent from "./models/IrrigationEvent";
import AIScheduleConfig from "./models/AIScheduleConfig";
import IrrigationSettings from "./models/configs/IrrigationSettings";
import SystemConfig from "./models/SystemConfig";
import Config from "./models/Config";
import IrrigationRecord from "./models/IrrigationRecord";

const now = new Date();
const hours = (h: number) => h * 60 * 60 * 1000;
const minutes = (m: number) => m * 60 * 1000;

function ago(ms: number): Date {
  return new Date(now.getTime() - ms);
}

function future(ms: number): Date {
  return new Date(now.getTime() + ms);
}

// ── Zones ──────────────────────────────────────────────
const zones = [
  {
    zoneId: "front-lawn",
    name: "Front Lawn",
    description: "Main front yard grass area",
    enabled: true,
    sortOrder: 0,
    defaultDurationMinutes: 20,
    maxDurationMinutes: 45,
    metadata: {
      plantType: "Bermuda Grass",
      sunExposure: "full" as const,
      soilType: "Clay loam",
      area: 1200,
      notes: "Gets afternoon sun, tends to dry out fast in summer",
    },
  },
  {
    zoneId: "back-lawn",
    name: "Back Lawn",
    description: "Backyard turf area near the patio",
    enabled: true,
    sortOrder: 1,
    defaultDurationMinutes: 25,
    maxDurationMinutes: 60,
    metadata: {
      plantType: "Bermuda Grass",
      sunExposure: "partial" as const,
      soilType: "Clay loam",
      area: 1800,
      notes: "Partially shaded by oak tree",
    },
  },
  {
    zoneId: "flower-beds",
    name: "Flower Beds",
    description: "Perennial garden beds along the driveway",
    enabled: true,
    sortOrder: 2,
    defaultDurationMinutes: 15,
    maxDurationMinutes: 30,
    metadata: {
      plantType: "Mixed perennials",
      sunExposure: "partial" as const,
      soilType: "Amended garden soil",
      area: 400,
      notes: "Drip irrigation, sensitive to overwatering",
    },
  },
  {
    zoneId: "vegetable-garden",
    name: "Vegetable Garden",
    description: "Raised beds with seasonal vegetables",
    enabled: true,
    sortOrder: 3,
    defaultDurationMinutes: 12,
    maxDurationMinutes: 25,
    metadata: {
      plantType: "Tomatoes, peppers, herbs",
      sunExposure: "full" as const,
      soilType: "Raised bed mix",
      area: 200,
      notes: "Needs consistent moisture, avoid wetting leaves",
    },
  },
  {
    zoneId: "side-yard",
    name: "Side Yard",
    description: "Narrow strip along the fence",
    enabled: false,
    sortOrder: 4,
    defaultDurationMinutes: 10,
    maxDurationMinutes: 20,
    metadata: {
      plantType: "Ground cover",
      sunExposure: "shade" as const,
      soilType: "Sandy",
      area: 300,
      notes: "Disabled — replumbing needed after freeze damage",
    },
  },
];

// ── Programs ───────────────────────────────────────────
const programIds = {
  morning: randomUUID(),
  evening: randomUUID(),
  weekendDeep: randomUUID(),
};

const programs = [
  {
    programId: programIds.morning,
    name: "Morning Quick Water",
    enabled: true,
    scheduleCron: "0 6 * * 1,3,5",
    zoneEntries: [
      { zoneId: "front-lawn", durationMinutes: 15 },
      { zoneId: "back-lawn", durationMinutes: 15 },
      { zoneId: "flower-beds", durationMinutes: 10 },
    ],
  },
  {
    programId: programIds.evening,
    name: "Evening Veggie Drip",
    enabled: true,
    scheduleCron: "0 19 * * *",
    zoneEntries: [
      { zoneId: "vegetable-garden", durationMinutes: 12 },
      { zoneId: "flower-beds", durationMinutes: 8 },
    ],
  },
  {
    programId: programIds.weekendDeep,
    name: "Weekend Deep Soak",
    enabled: true,
    scheduleCron: "0 5 * * 6",
    zoneEntries: [
      { zoneId: "front-lawn", durationMinutes: 30 },
      { zoneId: "back-lawn", durationMinutes: 35 },
      { zoneId: "flower-beds", durationMinutes: 15 },
      { zoneId: "vegetable-garden", durationMinutes: 15 },
    ],
  },
];

// ── Heartbeats ─────────────────────────────────────────
function generateHeartbeats(): object[] {
  const entries: object[] = [];
  const deviceIp = "192.168.1.50";

  for (let i = 0; i < 72; i++) {
    const ts = ago(hours(i));
    const hour = ts.getHours();
    const isDaytime = hour >= 7 && hour < 20;
    const baseTemp = isDaytime ? 85 + Math.random() * 10 : 68 + Math.random() * 8;
    const humidity = isDaytime ? 35 + Math.random() * 15 : 55 + Math.random() * 20;
    const isRaining = i >= 18 && i <= 22;
    const precipProb = isRaining ? 75 + Math.random() * 20 : Math.random() * 25;

    // Each tracked reading carries `since` = when it last changed. For seed data we anchor
    // the rain streak (hours 18–22 ago) to its onset so the rain-pause window has a
    // realistic start; the other readings simply mark this heartbeat's own time.
    const rainSince = isRaining ? ago(hours(22)) : ts;

    entries.push({
      timestamp: ts,
      guard: { triggered: true, since: ts },
      sensors: {
        waterPsi: { value: 48 + Math.random() * 8, since: ts },
        rain: { triggered: isRaining, since: rainSince },
        soil: { triggered: humidity > 60, since: ts },
      },
      device: {
        ip: deviceIp,
        tempF: Math.round(baseTemp * 10) / 10,
        humidity: Math.round(humidity * 10) / 10,
        baselinePsi: 50,
        connectedSensors: ["PRESSURE", "RAIN", "SOIL"],
      },
      weather: {
        locationName: "Austin, TX",
        fetchedAt: ts,
        expiresAt: new Date(ts.getTime() + hours(1)),
        temperature: Math.round(baseTemp),
        temperatureUnit: "F",
        precipitationProbability: Math.round(precipProb),
        isDaytime,
        shortForecast: isRaining
          ? "Scattered Thunderstorms"
          : isDaytime
            ? "Mostly Sunny"
            : "Clear",
        periodStart: ts,
        periodEnd: new Date(ts.getTime() + hours(6)),
      },
    });
  }

  return entries;
}

// ── AI Schedule Runs & Entries ─────────────────────────
const runIds = {
  completed: randomUUID(),
  completedYesterday: randomUUID(),
  skippedRain: randomUUID(),
  upcoming: randomUUID(),
};

const scheduleRuns = [
  {
    scheduleRunId: runIds.completed,
    triggeredBy: "cron" as const,
    status: "completed" as const,
    aiProvider: "anthropic",
    aiModel: "claude-sonnet-4-20250514",
    promptTokens: 2847,
    completionTokens: 1203,
    entries: 3,
    reasoning:
      "Conditions are favorable for irrigation today. Temperature forecast is 88°F with only 10% precipitation probability. No rain detected in the past 48 hours. Soil moisture sensors indicate dry conditions across all zones. Scheduling front lawn, back lawn, and vegetable garden during the preferred early morning window to minimize evaporation.",
    startedAt: ago(hours(4)),
    completedAt: ago(hours(4) - minutes(12)),
  },
  {
    scheduleRunId: runIds.completedYesterday,
    triggeredBy: "manual" as const,
    status: "completed" as const,
    aiProvider: "anthropic",
    aiModel: "claude-sonnet-4-20250514",
    promptTokens: 3102,
    completionTokens: 987,
    entries: 4,
    reasoning:
      "Manual trigger requested. Evaluating all zones. Yesterday's high was 92°F and no irrigation occurred in the past 2 days. All enabled zones are due for watering. Scheduling a full cycle with slightly reduced durations for flower beds due to their drip system sensitivity.",
    startedAt: ago(hours(28)),
    completedAt: ago(hours(28) - minutes(8)),
  },
  {
    scheduleRunId: runIds.upcoming,
    triggeredBy: "cron" as const,
    status: "completed" as const,
    aiProvider: "anthropic",
    aiModel: "claude-sonnet-4-20250514",
    promptTokens: 2910,
    completionTokens: 1045,
    entries: 3,
    reasoning:
      "Planning tomorrow's irrigation. Today's watering was successful. Scheduling a follow-up with slightly reduced durations since soil moisture should still be adequate. Forecast is partly cloudy with low precipitation probability.",
    startedAt: ago(hours(3)),
    completedAt: ago(hours(3) - minutes(5)),
  },
  {
    scheduleRunId: runIds.skippedRain,
    triggeredBy: "cron" as const,
    status: "completed" as const,
    aiProvider: "anthropic",
    aiModel: "claude-sonnet-4-20250514",
    promptTokens: 2650,
    completionTokens: 412,
    entries: 0,
    reasoning:
      "Rain detected by sensor within the past 20 hours and forecast shows 80% precipitation probability for the next 12 hours. Soil moisture readings are adequate. Skipping all irrigation to conserve water. Will re-evaluate at next scheduled run.",
    startedAt: ago(hours(52)),
    completedAt: ago(hours(52) - minutes(3)),
  },
];

const scheduleEntries = [
  // Today's run entries
  {
    scheduleRunId: runIds.completed,
    zoneId: "front-lawn",
    plannedStartAt: ago(hours(3) + minutes(30)),
    plannedDurationMinutes: 20,
    status: "completed" as const,
    aiReasoning:
      "Front lawn soil moisture is low and last irrigation was 3 days ago. Full default duration recommended.",
    weatherContext: {
      precipitationProbability: 10,
      forecastSummary: "Mostly Sunny, high of 88°F",
      recentRainDetected: false,
    },
  },
  {
    scheduleRunId: runIds.completed,
    zoneId: "back-lawn",
    plannedStartAt: ago(hours(3) + minutes(5)),
    plannedDurationMinutes: 25,
    status: "completed" as const,
    aiReasoning:
      "Back lawn is partially shaded but still showing dry conditions. Running full duration.",
    weatherContext: {
      precipitationProbability: 10,
      forecastSummary: "Mostly Sunny, high of 88°F",
      recentRainDetected: false,
    },
  },
  {
    scheduleRunId: runIds.completed,
    zoneId: "vegetable-garden",
    plannedStartAt: ago(hours(2) + minutes(35)),
    plannedDurationMinutes: 12,
    status: "completed" as const,
    aiReasoning:
      "Vegetable garden requires consistent moisture. Scheduling standard drip cycle.",
    weatherContext: {
      precipitationProbability: 10,
      forecastSummary: "Mostly Sunny, high of 88°F",
      recentRainDetected: false,
    },
  },
  // Yesterday's run entries
  {
    scheduleRunId: runIds.completedYesterday,
    zoneId: "front-lawn",
    plannedStartAt: ago(hours(27)),
    plannedDurationMinutes: 20,
    status: "completed" as const,
    aiReasoning: "Due for watering — 2 days since last irrigation.",
    weatherContext: {
      precipitationProbability: 5,
      forecastSummary: "Sunny, high of 92°F",
      recentRainDetected: false,
    },
  },
  {
    scheduleRunId: runIds.completedYesterday,
    zoneId: "back-lawn",
    plannedStartAt: ago(hours(26) + minutes(35)),
    plannedDurationMinutes: 25,
    status: "completed" as const,
    aiReasoning: "Dry conditions across backyard, full cycle recommended.",
    weatherContext: {
      precipitationProbability: 5,
      forecastSummary: "Sunny, high of 92°F",
      recentRainDetected: false,
    },
  },
  {
    scheduleRunId: runIds.completedYesterday,
    zoneId: "flower-beds",
    plannedStartAt: ago(hours(26) + minutes(5)),
    plannedDurationMinutes: 10,
    status: "completed" as const,
    aiReasoning:
      "Flower beds getting reduced duration due to drip system — less evaporation loss.",
    weatherContext: {
      precipitationProbability: 5,
      forecastSummary: "Sunny, high of 92°F",
      recentRainDetected: false,
    },
  },
  {
    scheduleRunId: runIds.completedYesterday,
    zoneId: "vegetable-garden",
    plannedStartAt: ago(hours(25) + minutes(50)),
    plannedDurationMinutes: 12,
    status: "completed" as const,
    aiReasoning: "Standard veggie drip cycle.",
    weatherContext: {
      precipitationProbability: 5,
      forecastSummary: "Sunny, high of 92°F",
      recentRainDetected: false,
    },
  },
  // Upcoming planned entries (future)
  {
    scheduleRunId: runIds.upcoming,
    zoneId: "front-lawn",
    plannedStartAt: future(hours(20)),
    plannedDurationMinutes: 18,
    status: "planned" as const,
    aiReasoning:
      "Next-day follow-up: slightly reduced duration since we watered today. Forecast looks clear.",
    weatherContext: {
      precipitationProbability: 15,
      forecastSummary: "Partly Cloudy, high of 86°F",
      recentRainDetected: false,
    },
  },
  {
    scheduleRunId: runIds.upcoming,
    zoneId: "back-lawn",
    plannedStartAt: future(hours(20) + minutes(25)),
    plannedDurationMinutes: 20,
    status: "planned" as const,
    aiReasoning:
      "Scheduling reduced back lawn cycle for tomorrow morning.",
    weatherContext: {
      precipitationProbability: 15,
      forecastSummary: "Partly Cloudy, high of 86°F",
      recentRainDetected: false,
    },
  },
  {
    scheduleRunId: runIds.upcoming,
    zoneId: "vegetable-garden",
    plannedStartAt: future(hours(20) + minutes(50)),
    plannedDurationMinutes: 12,
    status: "planned" as const,
    aiReasoning: "Daily veggie drip — consistent schedule.",
    weatherContext: {
      precipitationProbability: 15,
      forecastSummary: "Partly Cloudy, high of 86°F",
      recentRainDetected: false,
    },
  },
  // A skipped entry
  {
    scheduleRunId: runIds.upcoming,
    zoneId: "flower-beds",
    plannedStartAt: future(hours(20) + minutes(15)),
    plannedDurationMinutes: 10,
    status: "skipped" as const,
    aiReasoning: "Flower beds received adequate moisture from today's run.",
    weatherContext: {
      precipitationProbability: 15,
      forecastSummary: "Partly Cloudy, high of 86°F",
      recentRainDetected: false,
    },
    skipReason: "Sufficient soil moisture detected from earlier irrigation cycle",
  },
];

// ── Irrigation Commands ────────────────────────────────
function generateCommands(): object[] {
  const commands: object[] = [];
  const completedEntries = scheduleEntries.filter((e) => e.status === "completed");

  for (const entry of completedEntries) {
    const cmdOn = {
      zoneId: entry.zoneId,
      action: "on",
      durationMinutes: entry.plannedDurationMinutes,
      source: "schedule" as const,
      status: "acknowledged" as const,
      sentAt: entry.plannedStartAt,
      acknowledgedAt: new Date(entry.plannedStartAt.getTime() + 1200),
      createdAt: entry.plannedStartAt,
    };
    const cmdOff = {
      zoneId: entry.zoneId,
      action: "off",
      source: "schedule" as const,
      status: "acknowledged" as const,
      sentAt: new Date(
        entry.plannedStartAt.getTime() + minutes(entry.plannedDurationMinutes)
      ),
      acknowledgedAt: new Date(
        entry.plannedStartAt.getTime() +
          minutes(entry.plannedDurationMinutes) +
          800
      ),
      createdAt: new Date(
        entry.plannedStartAt.getTime() + minutes(entry.plannedDurationMinutes)
      ),
    };
    commands.push(cmdOn, cmdOff);
  }

  // A manual command from 6 hours ago
  commands.push({
    zoneId: "flower-beds",
    action: "on",
    durationMinutes: 5,
    source: "manual" as const,
    status: "acknowledged" as const,
    sentAt: ago(hours(6)),
    acknowledgedAt: ago(hours(6) - 900),
    createdAt: ago(hours(6)),
  });
  commands.push({
    zoneId: "flower-beds",
    action: "off",
    source: "manual" as const,
    status: "acknowledged" as const,
    sentAt: ago(hours(6) - minutes(5)),
    acknowledgedAt: ago(hours(6) - minutes(5) - 800),
    createdAt: ago(hours(6) - minutes(5)),
  });

  return commands;
}

// ── Irrigation Events ──────────────────────────────────
function generateEvents(): object[] {
  const events: object[] = [];
  const completedEntries = scheduleEntries.filter((e) => e.status === "completed");

  for (const entry of completedEntries) {
    events.push({
      zone: entry.zoneId,
      action: "on",
      waterPressure: 48 + Math.random() * 6,
      source: "schedule",
      createdAt: entry.plannedStartAt,
    });
    events.push({
      zone: entry.zoneId,
      action: "off",
      waterPressure: 50 + Math.random() * 4,
      source: "schedule",
      createdAt: new Date(
        entry.plannedStartAt.getTime() + minutes(entry.plannedDurationMinutes)
      ),
    });
  }

  // Manual event for flower beds
  events.push({
    zone: "flower-beds",
    action: "on",
    waterPressure: 49.2,
    source: "manual",
    createdAt: ago(hours(6)),
  });
  events.push({
    zone: "flower-beds",
    action: "off",
    waterPressure: 51.1,
    source: "manual",
    createdAt: ago(hours(6) - minutes(5)),
  });

  return events;
}

// ── Irrigation Records ────────────────────────────────
function generateIrrigationRecords(): object[] {
  const records: object[] = [];
  const completedEntries = scheduleEntries.filter((e) => e.status === "completed");

  for (const entry of completedEntries) {
    const startedAt = entry.plannedStartAt;
    const durationMs = minutes(entry.plannedDurationMinutes);
    const endedAt = new Date(startedAt.getTime() + durationMs);
    const source = entry.scheduleRunId === runIds.completedYesterday
      && scheduleRuns.find((r) => r.scheduleRunId === runIds.completedYesterday)?.triggeredBy === "manual"
      ? "manual" as const
      : "ai-schedule" as const;

    records.push({
      zoneId: entry.zoneId,
      source,
      status: "completed" as const,
      startedAt,
      endedAt,
      durationMs,
      pressureStart: 48 + Math.random() * 6,
      pressureEnd: 50 + Math.random() * 4,
      programId: null,
      createdAt: startedAt,
    });
  }

  // Manual flower-beds record from 6 hours ago
  const manualStart = ago(hours(6));
  const manualDuration = minutes(5);
  records.push({
    zoneId: "flower-beds",
    source: "manual" as const,
    status: "completed" as const,
    startedAt: manualStart,
    endedAt: new Date(manualStart.getTime() + manualDuration),
    durationMs: manualDuration,
    pressureStart: 49.2,
    pressureEnd: 51.1,
    programId: null,
    createdAt: manualStart,
  });

  // A few older program-based records from days ago
  const programRecords = [
    { zoneId: "front-lawn", daysAgo: 3, durationMin: 15 },
    { zoneId: "back-lawn", daysAgo: 3, durationMin: 15 },
    { zoneId: "flower-beds", daysAgo: 3, durationMin: 10 },
    { zoneId: "vegetable-garden", daysAgo: 4, durationMin: 12 },
    { zoneId: "flower-beds", daysAgo: 4, durationMin: 8 },
    { zoneId: "front-lawn", daysAgo: 5, durationMin: 30 },
    { zoneId: "back-lawn", daysAgo: 5, durationMin: 35 },
    { zoneId: "flower-beds", daysAgo: 5, durationMin: 15 },
    { zoneId: "vegetable-garden", daysAgo: 5, durationMin: 15 },
    { zoneId: "front-lawn", daysAgo: 7, durationMin: 20 },
    { zoneId: "back-lawn", daysAgo: 7, durationMin: 25 },
    { zoneId: "vegetable-garden", daysAgo: 8, durationMin: 12 },
  ];

  for (const pr of programRecords) {
    const startedAt = ago(hours(24 * pr.daysAgo) + hours(6));
    const durationMs = minutes(pr.durationMin);
    records.push({
      zoneId: pr.zoneId,
      source: "program" as const,
      status: "completed" as const,
      startedAt,
      endedAt: new Date(startedAt.getTime() + durationMs),
      durationMs,
      pressureStart: 47 + Math.random() * 7,
      pressureEnd: 49 + Math.random() * 5,
      programId: pr.durationMin <= 15 ? programIds.morning : programIds.weekendDeep,
      createdAt: startedAt,
    });
  }

  // One failed record from 2 days ago
  const failStart = ago(hours(48) + hours(6));
  records.push({
    zoneId: "side-yard",
    source: "program" as const,
    status: "failed" as const,
    startedAt: failStart,
    endedAt: new Date(failStart.getTime() + minutes(1)),
    durationMs: minutes(1),
    pressureStart: 12.3,
    pressureEnd: null,
    programId: programIds.morning,
    createdAt: failStart,
  });

  return records;
}

// ── Main Seed ──────────────────────────────────────────
async function seed() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not set");
    process.exit(1);
  }

  console.log(`Connecting to ${uri}…`);
  await mongoose.connect(uri);
  console.log("Connected.\n");

  // Clear existing data
  const collections = [
    Zone,
    IrrigationProgram,
    Heartbeat,
    ScheduleRun,
    ScheduleEntry,
    IrrigationCommand,
    IrrigationEvent,
    IrrigationRecord,
    Config,
  ];
  for (const Model of collections as any[]) {
    await Model.deleteMany({});
  }
  console.log("Cleared existing data.\n");

  // Insert zones
  await Zone.insertMany(zones);
  console.log(`✓ ${zones.length} zones`);

  // Insert programs
  await IrrigationProgram.insertMany(programs);
  console.log(`✓ ${programs.length} irrigation programs`);

  // Insert heartbeats (72 hours of hourly data)
  const heartbeats = generateHeartbeats();
  await Heartbeat.insertMany(heartbeats);
  console.log(`✓ ${heartbeats.length} heartbeats (72h)`);

  // Insert schedule runs
  await ScheduleRun.insertMany(scheduleRuns);
  console.log(`✓ ${scheduleRuns.length} schedule runs`);

  // Insert schedule entries
  await ScheduleEntry.insertMany(scheduleEntries);
  console.log(`✓ ${scheduleEntries.length} schedule entries`);

  // Insert commands
  const commands = generateCommands();
  await IrrigationCommand.insertMany(commands);
  console.log(`✓ ${commands.length} irrigation commands`);

  // Insert events
  const events = generateEvents();
  await IrrigationEvent.insertMany(events);
  console.log(`✓ ${events.length} irrigation events`);

  // Insert irrigation records
  const irrigationRecords = generateIrrigationRecords();
  await IrrigationRecord.insertMany(irrigationRecords);
  console.log(`✓ ${irrigationRecords.length} irrigation records`);

  // Irrigation settings
  await IrrigationSettings.create({
    preferredTimeWindows: [
      { startHour: 4, endHour: 7 },
      { startHour: 20, endHour: 22 },
    ],
    waterSavingMode: "normal",
  });
  console.log("✓ irrigation settings");

  // System config — smart mode
  await SystemConfig.create({ irrigationMode: "smart" });
  console.log("✓ system config (smart mode)");

  // AI schedule config
  await AIScheduleConfig.create({
    enabled: true,
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "sk-test-placeholder",
    scheduleCron: "0 4 * * *",
    evaluationWindowHours: 24,
    userContext:
      "Residential property in Austin, TX. Hot summers, clay soil. Prefer early morning watering to reduce evaporation. Vegetable garden needs daily moisture. Flower beds are on drip — careful not to overwater.",
    preferences: {
      conservativeWatering: true,
      rainThresholdPercent: 40,
      maxDailyRunMinutes: 120,
      minDaysBetweenRuns: 1,
    },
    lastRunAt: ago(hours(4)),
    lastRunStatus: "success",
    lastRunMessage: "Scheduled 3 zones for irrigation",
  });
  console.log("✓ AI schedule config");

  console.log("\nSeed complete!");
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
