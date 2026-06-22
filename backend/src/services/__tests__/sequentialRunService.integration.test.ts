/**
 * End-to-end reliability tests for the sequential-run execution path.
 *
 * These drive the REAL startSequentialRun -> startZone -> onZoneOff / advanceToNextZone
 * state machine (only the mongoose models, the controller command, and realtime emit are
 * faked) to reproduce the reported failure modes and prove the mechanism is solid:
 *
 *   1. The exact durations that were scheduled reach the controller, in order.
 *   2. A spurious "off" arriving a few seconds after a zone starts does NOT advance the
 *      run (the "zone runs for a few instants and gets cancelled" symptom).
 *   3. A legitimate "off" (past the runtime floor) advances to the next zone, and the run
 *      finalizes as completed once every zone has run.
 */

interface FakeZoneEntry {
  zoneId: string;
  name: string;
  durationMinutes: number;
  status: string;
  startedAt?: Date;
  completedAt?: Date;
  commandId?: string | null;
  error?: string;
}

interface FakeRun {
  _id: { toString(): string };
  source: string;
  programId: string | null;
  status: string;
  zones: FakeZoneEntry[];
  currentZoneIndex: number;
  startedAt: Date;
  completedAt?: Date;
  statusReason?: string | null;
  deferredAt?: Date | null;
  deferralDeadline?: Date | null;
  save(): Promise<void>;
  toObject(): Record<string, unknown>;
}

// One in-memory run, shared between create()/findById() so mutations persist like a DB.
let store: FakeRun | null = null;

const makeRun = (doc: Partial<FakeRun>): FakeRun => {
  const run: FakeRun = {
    _id: { toString: () => "run-1" },
    source: doc.source ?? "ai-schedule",
    programId: doc.programId ?? null,
    status: doc.status ?? "running",
    zones: (doc.zones ?? []) as FakeZoneEntry[],
    currentZoneIndex: doc.currentZoneIndex ?? 0,
    startedAt: doc.startedAt ?? new Date(),
    save: async () => {},
    toObject() {
      return {
        _id: "run-1",
        source: this.source,
        programId: this.programId,
        status: this.status,
        zones: this.zones,
        currentZoneIndex: this.currentZoneIndex,
        startedAt: this.startedAt,
        completedAt: this.completedAt,
        statusReason: this.statusReason
      };
    }
  };
  return run;
};

jest.mock("../../models/SequentialRun", () => ({
  __esModule: true,
  default: {
    create: jest.fn(async (doc: Partial<FakeRun>) => {
      store = makeRun(doc);
      return store;
    }),
    findById: jest.fn(async (id: string) => (store && store._id.toString() === id ? store : null)),
    findOne: jest.fn(() => ({ sort: () => ({ lean: async () => (store ? store.toObject() : null) }) }))
  }
}));

jest.mock("../../models/Zone", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(() => ({ select: () => ({ lean: async () => ({ enabled: true }) }) }))
  }
}));

const createCommandMock = jest.fn(async (zoneId: string) => ({ _id: `cmd-${zoneId}` }));
jest.mock("../irrigationCommandService", () => ({
  __esModule: true,
  createCommand: (...args: unknown[]) => createCommandMock(...(args as [string])) as unknown
}));

// finalizeRun dynamically imports this to mark the owning AI program completed.
jest.mock("../../models/IrrigationProgram", () => ({
  __esModule: true,
  default: { updateOne: jest.fn(async () => ({ matchedCount: 1 })) }
}));

jest.mock("../realtimeService", () => ({ __esModule: true, emitRealtimeEvent: jest.fn() }));

import {
  startSequentialRun,
  onZoneOff,
  clearActiveRun,
  isRunActive,
  isSpuriousOffForActiveRun,
  MIN_LEGIT_RUNTIME_MS
} from "../sequentialRunService";

const backdateCurrentZone = (secondsAgo: number) => {
  const z = store!.zones[store!.currentZoneIndex]!;
  z.startedAt = new Date(Date.now() - secondsAgo * 1000);
};

beforeEach(() => {
  store = null;
  createCommandMock.mockClear();
});

afterEach(() => {
  clearActiveRun(); // clears the in-memory activeRun + any pending safety timeout
});

describe("sequential run execution", () => {
  it("sends each scheduled duration to the controller, in order, with the run's source", async () => {
    await startSequentialRun(
      [
        { zoneId: "front-lawn", name: "Front Lawn", durationMinutes: 15 },
        { zoneId: "back-lawn", name: "Back Lawn", durationMinutes: 25 }
      ],
      "ai-schedule",
      "prog-1"
    );

    // First zone is on with its exact scheduled duration (no double water-saving reduction).
    expect(createCommandMock).toHaveBeenCalledTimes(1);
    expect(createCommandMock).toHaveBeenLastCalledWith("front-lawn", "on", 15, "ai-schedule");
    expect(store!.zones[0]!.status).toBe("running");

    // Legitimate completion of zone 1 -> zone 2 starts with ITS scheduled duration.
    backdateCurrentZone(15 * 60);
    await onZoneOff("front-lawn");

    expect(store!.zones[0]!.status).toBe("completed");
    expect(createCommandMock).toHaveBeenLastCalledWith("back-lawn", "on", 25, "ai-schedule");
    expect(store!.zones[1]!.status).toBe("running");
  });

  it("does NOT advance on a spurious off a few seconds after the zone starts (the 'few instants' bug)", async () => {
    await startSequentialRun(
      [
        { zoneId: "front-lawn", name: "Front Lawn", durationMinutes: 15 },
        { zoneId: "back-lawn", name: "Back Lawn", durationMinutes: 25 }
      ],
      "ai-schedule",
      "prog-1"
    );
    expect(createCommandMock).toHaveBeenCalledTimes(1); // only zone 1 turned on so far

    // Controller echo: zone reports off 5s after starting. Must be ignored.
    backdateCurrentZone(5);
    await onZoneOff("front-lawn");

    expect(store!.zones[0]!.status).toBe("running"); // still running, not completed/skipped
    expect(store!.zones[1]!.status).toBe("queued"); // next zone NOT prematurely started
    expect(createCommandMock).toHaveBeenCalledTimes(1); // no extra command was issued
    expect(isRunActive()).toBe(true);
  });

  it("flags an early off as spurious (so persistEvent drops it before it poisons de-dup)", async () => {
    await startSequentialRun(
      [{ zoneId: "front-lawn", name: "Front Lawn", durationMinutes: 15 }],
      "ai-schedule",
      "prog-1"
    );

    backdateCurrentZone(5); // 5s in — spurious
    expect(await isSpuriousOffForActiveRun("front-lawn")).toBe(true);

    backdateCurrentZone(MIN_LEGIT_RUNTIME_MS / 1000 + 1); // past the floor — genuine
    expect(await isSpuriousOffForActiveRun("front-lawn")).toBe(false);

    // Not the current zone, or no active run → never spurious.
    expect(await isSpuriousOffForActiveRun("some-other-zone")).toBe(false);
    clearActiveRun();
    expect(await isSpuriousOffForActiveRun("front-lawn")).toBe(false);
  });

  it("honors an off once the runtime floor has passed, and finalizes the run as completed", async () => {
    await startSequentialRun(
      [{ zoneId: "front-lawn", name: "Front Lawn", durationMinutes: 15 }],
      "ai-schedule",
      "prog-1"
    );

    backdateCurrentZone(MIN_LEGIT_RUNTIME_MS / 1000 + 1);
    await onZoneOff("front-lawn");

    expect(store!.zones[0]!.status).toBe("completed");
    expect(store!.status).toBe("completed");
    expect(isRunActive()).toBe(false);
  });
});
