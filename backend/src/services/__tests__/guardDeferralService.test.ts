/**
 * Tests for the guard-deferral monitor's confirmation-based handling of zone-attributed
 * pressure dips, and its run-scoped bookkeeping.
 *
 * A HARDWARE guard activation that begins after a commanded zone turned on (guard was
 * clear at zone start) does not defer immediately: the zone keeps running and a forced
 * heartbeat ~1 minute later confirms. If that confirmation still shows the guard active
 * or waterPsi below the device baseline, the zone is deferred (genuine low pressure);
 * otherwise the dip is attributed to the zone's startup and the zone is left alone for
 * its remainder (each zone is confirmed at most once). Rain-pause activations and
 * hardware activations that pre-date the zone (or outlive it) defer via the grace path.
 */

let runStore: Record<string, unknown> | null = null;
const activeRunRef: { current: Record<string, unknown> | null } = { current: null };
let rainPauseState: { active: boolean; source?: string } = { active: false };

// Chainable find() result usable both as `await find(...)` and `find(...).sort().limit()`.
const chainableFind = (result: unknown[]) => {
  const p = Promise.resolve(result) as Promise<unknown[]> & {
    sort: () => { limit: () => Promise<unknown[]> };
  };
  p.sort = () => ({ limit: async () => result });
  return p;
};

jest.mock("../../models/SequentialRun", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(() => ({ lean: async () => runStore })),
    findOne: jest.fn(async () => null),
    find: jest.fn(() => chainableFind([]))
  }
}));

jest.mock("../../models/ScheduleEntry", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(async () => null),
    find: jest.fn(() => chainableFind([]))
  }
}));

jest.mock("../../models/IrrigationProgram", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(async () => null),
    find: jest.fn(() => chainableFind([]))
  }
}));

jest.mock("../../models/Heartbeat", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(() => ({ sort: () => ({ lean: async () => null }) }))
  }
}));

jest.mock("../../models/Zone", () => ({
  __esModule: true,
  default: {
    find: jest.fn(() => ({ lean: async () => [] }))
  }
}));

const deviceConfigUpdateOneMock = jest.fn(async () => ({}));
jest.mock("../../models/DeviceConfig", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(() => ({
      sort: () => ({ lean: async () => ({ deviceIp: "192.168.1.199" }) })
    })),
    updateOne: (...args: unknown[]) => deviceConfigUpdateOneMock(...(args as []))
  }
}));

const deferCurrentZoneMock = jest.fn(async () => true);
const resumeDeferredRunMock = jest.fn(async () => true);
jest.mock("../sequentialRunService", () => ({
  __esModule: true,
  getActiveRun: () => activeRunRef.current,
  isRunActive: () => activeRunRef.current !== null,
  deferCurrentZone: (...args: unknown[]) => deferCurrentZoneMock(...(args as [])),
  resumeDeferredRun: (...args: unknown[]) => resumeDeferredRunMock(...(args as [])),
  startSequentialRun: jest.fn(async () => "run-x"),
  clearActiveRun: jest.fn()
}));

jest.mock("../guardService", () => ({
  __esModule: true,
  getRainPauseState: jest.fn(async () => rainPauseState)
}));

jest.mock("../irrigationSettingsService", () => ({
  __esModule: true,
  isWithinPreferredWindow: jest.fn(async () => true),
  getWaterSavingFactor: jest.fn(async () => 1.0)
}));

jest.mock("../realtimeService", () => ({ __esModule: true, emitRealtimeEvent: jest.fn() }));

import {
  handleHeartbeatForDeferral,
  startGuardDeferralMonitor,
  stopGuardDeferralMonitor,
  clearRunScopedGuardState,
  getLastKnownHardwareGuard
} from "../guardDeferralService";

const BASE_NOW = new Date("2026-07-11T12:00:00.000Z");

const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);

const setupRunningZone = (opts?: { zoneStartedSecondsAgo?: number; guardClearAtZoneStart?: boolean | null }) => {
  const startedAt = secondsAgo(opts?.zoneStartedSecondsAgo ?? 5);
  runStore = {
    status: "running",
    zones: [{ zoneId: "front", status: "running", startedAt }],
    deferralDeadline: null
  };
  activeRunRef.current = {
    runId: "run-1",
    source: "ai-schedule",
    currentZoneIndex: 0,
    timeoutTimer: null,
    guardClearAtZoneStart: opts?.guardClearAtZoneStart ?? true
  };
};

beforeEach(async () => {
  jest.useFakeTimers({ now: BASE_NOW });
  runStore = null;
  activeRunRef.current = null;
  rainPauseState = { active: false };
  deferCurrentZoneMock.mockClear();
  resumeDeferredRunMock.mockClear();
  deviceConfigUpdateOneMock.mockClear();

  await startGuardDeferralMonitor(); // resets all monitor state; no heartbeat in store
  await handleHeartbeatForDeferral({ guard: false }); // baseline: guard known-clear
});

afterEach(() => {
  stopGuardDeferralMonitor();
  jest.useRealTimers();
});

describe("zone-attributed guard confirmation", () => {
  it("does not defer on the initial rise and requests a forced heartbeat after 1 minute", async () => {
    setupRunningZone({ zoneStartedSecondsAgo: 5, guardClearAtZoneStart: true });

    await handleHeartbeatForDeferral({ guard: true });
    expect(deferCurrentZoneMock).not.toHaveBeenCalled();
    expect(deviceConfigUpdateOneMock).not.toHaveBeenCalled();

    // The confirmation timer fires at +60s and queues a forced heartbeat on the device.
    await jest.advanceTimersByTimeAsync(60_000);
    expect(deviceConfigUpdateOneMock).toHaveBeenCalledWith(
      { deviceIp: "192.168.1.199" },
      { $set: { forceHeartbeat: true } }
    );
    expect(deferCurrentZoneMock).not.toHaveBeenCalled();
  });

  it("defers when the confirmation heartbeat still shows the guard active", async () => {
    setupRunningZone({ zoneStartedSecondsAgo: 5, guardClearAtZoneStart: true });
    await handleHeartbeatForDeferral({ guard: true });

    jest.setSystemTime(new Date(Date.now() + 70_000));
    await handleHeartbeatForDeferral({ guard: true, sensors: { waterPsi: 38.4 }, device: { baselinePsi: 40 } });
    expect(deferCurrentZoneMock).toHaveBeenCalledTimes(1);
  });

  it("defers when the confirmation heartbeat reads psi below the baseline even with guard off", async () => {
    setupRunningZone({ zoneStartedSecondsAgo: 5, guardClearAtZoneStart: true });
    await handleHeartbeatForDeferral({ guard: true });

    jest.setSystemTime(new Date(Date.now() + 70_000));
    await handleHeartbeatForDeferral({ guard: false, sensors: { waterPsi: 38.4 }, device: { baselinePsi: 40 } });
    expect(deferCurrentZoneMock).toHaveBeenCalledTimes(1);
    // The same heartbeat's falling edge must not immediately resume the run it deferred.
    expect(resumeDeferredRunMock).not.toHaveBeenCalled();
  });

  it("continues the zone when the confirmation shows healthy pressure, and never re-checks that zone", async () => {
    setupRunningZone({ zoneStartedSecondsAgo: 5, guardClearAtZoneStart: true });
    await handleHeartbeatForDeferral({ guard: true });

    jest.setSystemTime(new Date(Date.now() + 70_000));
    await handleHeartbeatForDeferral({ guard: false, sensors: { waterPsi: 61.2 }, device: { baselinePsi: 40 } });
    expect(deferCurrentZoneMock).not.toHaveBeenCalled();

    // A second rise during the SAME zone: already confirmed once → stays suppressed.
    await handleHeartbeatForDeferral({ guard: true });
    jest.setSystemTime(new Date(Date.now() + 120_000));
    await handleHeartbeatForDeferral({ guard: true, sensors: { waterPsi: 38 }, device: { baselinePsi: 40 } });
    expect(deferCurrentZoneMock).not.toHaveBeenCalled();
  });

  it("cancels the confirmation when the guard clears early, and a later rise starts a fresh one", async () => {
    setupRunningZone({ zoneStartedSecondsAgo: 5, guardClearAtZoneStart: true });
    await handleHeartbeatForDeferral({ guard: true });

    // Dip resolves at +30s, before the confirmation point.
    jest.setSystemTime(new Date(Date.now() + 30_000));
    await handleHeartbeatForDeferral({ guard: false, sensors: { waterPsi: 61 }, device: { baselinePsi: 40 } });
    expect(deferCurrentZoneMock).not.toHaveBeenCalled();

    // A new rise later in the same (unconfirmed) zone starts a new confirmation, not a defer.
    jest.setSystemTime(new Date(Date.now() + 40_000));
    await handleHeartbeatForDeferral({ guard: true });
    expect(deferCurrentZoneMock).not.toHaveBeenCalled();
  });

  it("tracks the raw hardware guard reading for zone-start snapshots", async () => {
    expect(getLastKnownHardwareGuard()).toBe(false);
    setupRunningZone();
    await handleHeartbeatForDeferral({ guard: true });
    expect(getLastKnownHardwareGuard()).toBe(true);
  });

  it("defers when the guard was already active before the zone started", async () => {
    // startZone snapshotted guard=active → activation is not attributable to this zone.
    setupRunningZone({ zoneStartedSecondsAgo: 120, guardClearAtZoneStart: false });

    await handleHeartbeatForDeferral({ guard: true });
    expect(deferCurrentZoneMock).toHaveBeenCalledTimes(1);
  });

  it("still defers on a rain-pause rise mid-run (rain is never zone-induced)", async () => {
    setupRunningZone({ zoneStartedSecondsAgo: 120, guardClearAtZoneStart: true });

    rainPauseState = { active: true, source: "user (moderate)" };
    await handleHeartbeatForDeferral({ guard: false }); // combined guard rises via rain pause
    expect(deferCurrentZoneMock).toHaveBeenCalledTimes(1);
  });

  it("treats a guard that outlives the dipping zone as a real activation for the next zone", async () => {
    setupRunningZone({ zoneStartedSecondsAgo: 5, guardClearAtZoneStart: true });
    await handleHeartbeatForDeferral({ guard: true }); // confirmation pending for zone 0
    expect(deferCurrentZoneMock).not.toHaveBeenCalled();

    // The run advances to the next zone, and the guard is STILL active well past the
    // grace period for that zone — the open confirmation must not carry over.
    jest.setSystemTime(new Date(Date.now() + 10 * 60_000));
    runStore = {
      status: "running",
      zones: [
        { zoneId: "front", status: "completed", startedAt: secondsAgo(700) },
        { zoneId: "garden", status: "running", startedAt: secondsAgo(120) }
      ],
      deferralDeadline: null
    };
    (activeRunRef.current as { currentZoneIndex: number }).currentZoneIndex = 1;
    (activeRunRef.current as { guardClearAtZoneStart: boolean }).guardClearAtZoneStart = false;

    await handleHeartbeatForDeferral({ guard: true });
    expect(deferCurrentZoneMock).toHaveBeenCalledTimes(1);
  });
});

describe("run-scoped bookkeeping (grace deferral)", () => {
  it("clears a pending grace deferral for the finished run so it cannot fire later", async () => {
    // Guard rises 5s into the zone, but it was ALREADY active when the zone started
    // (not attributable) → grace period pending.
    setupRunningZone({ zoneStartedSecondsAgo: 5, guardClearAtZoneStart: false });
    await handleHeartbeatForDeferral({ guard: true });
    expect(deferCurrentZoneMock).not.toHaveBeenCalled(); // within grace

    // Run finishes/cancels → its state is cleared. The stale grace deferral must not
    // defer whatever runs next.
    clearRunScopedGuardState("run-1");

    jest.setSystemTime(new Date(Date.now() + 90_000)); // grace would have expired
    await handleHeartbeatForDeferral({ guard: true });
    expect(deferCurrentZoneMock).not.toHaveBeenCalled();
  });

  it("leaves state for other runs untouched (grace deferral still fires)", async () => {
    setupRunningZone({ zoneStartedSecondsAgo: 5, guardClearAtZoneStart: false });
    await handleHeartbeatForDeferral({ guard: true });

    clearRunScopedGuardState("some-other-run");

    jest.setSystemTime(new Date(Date.now() + 90_000));
    await handleHeartbeatForDeferral({ guard: true });
    expect(deferCurrentZoneMock).toHaveBeenCalledTimes(1);
  });

  it("clears a pending zone confirmation for the finished run", async () => {
    setupRunningZone({ zoneStartedSecondsAgo: 5, guardClearAtZoneStart: true });
    await handleHeartbeatForDeferral({ guard: true }); // confirmation pending

    clearRunScopedGuardState("run-1");

    jest.setSystemTime(new Date(Date.now() + 90_000));
    await handleHeartbeatForDeferral({ guard: true, sensors: { waterPsi: 10 }, device: { baselinePsi: 40 } });
    expect(deferCurrentZoneMock).not.toHaveBeenCalled();
  });

  it("leaves a pending confirmation for other runs untouched", async () => {
    setupRunningZone({ zoneStartedSecondsAgo: 5, guardClearAtZoneStart: true });
    await handleHeartbeatForDeferral({ guard: true }); // confirmation pending

    clearRunScopedGuardState("some-other-run");

    jest.setSystemTime(new Date(Date.now() + 90_000));
    await handleHeartbeatForDeferral({ guard: true, sensors: { waterPsi: 10 }, device: { baselinePsi: 40 } });
    expect(deferCurrentZoneMock).toHaveBeenCalledTimes(1);
  });
});
