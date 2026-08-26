import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import type { AIScheduleConfig, IrrigationMode, IrrigationProgram, Zone } from "../types";

/**
 * Behavioral tests for IrrigationQueuePanel after its migration from
 * fetch+useState+useEffect to two mode-gated TanStack Query `useQuery` calls.
 *
 * The panel is MODE-SWITCHED: it runs a "smart" query (fetchAIScheduleConfig +
 * ai-schedule fetchPrograms) and a "scheduled" query (manual fetchPrograms +
 * fetchMaterializedProgramEntries), each `enabled` only for the active mode.
 * These tests lock in which fetches fire per mode, that bumping `refreshKey`
 * refetches the active mode, and that the mode toggle drives updateSystemConfig
 * + onModeChanged. The api module is mocked, so nothing hits the network.
 */

// Replace every api export with a stub. Functions become vi.fn() resolving to
// undefined by default; per-test implementations are set in beforeEach/tests.
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(actual)) {
    mocked[key] = typeof value === "function" ? vi.fn() : value;
  }
  return mocked;
});

// DateTimeInput pulls in react-datepicker; the queue cards never open the
// defer editor in these tests, but stub it to keep the tree light and stable.
vi.mock("./DateTimeInput", () => ({ default: () => <div data-testid="date-time-input" /> }));

import IrrigationQueuePanel from "./IrrigationQueuePanel";
import * as api from "../api";

const zones: Zone[] = [
  {
    zoneId: "z1",
    name: "Zone 1",
    enabled: true,
    sortOrder: 0,
    defaultDurationMinutes: 10,
    maxDurationMinutes: 30
  }
];

const aiProgram: IrrigationProgram = {
  programId: "ai-1",
  name: "AI Morning",
  enabled: true,
  source: "ai-schedule",
  status: "planned",
  plannedStartAt: new Date(Date.now() + 3_600_000).toISOString(),
  zoneEntries: [{ zoneId: "z1", durationMinutes: 12 }]
};

const manualProgram: IrrigationProgram = {
  programId: "prog-1",
  name: "Front Lawn",
  enabled: true,
  source: "manual",
  scheduleCron: "0 6 * * *",
  zoneEntries: [{ zoneId: "z1", durationMinutes: 15 }]
};

const aiScheduleConfig = { enabled: true } as AIScheduleConfig;

type Props = Parameters<typeof IrrigationQueuePanel>[0];

const baseProps = (overrides: Partial<Props> = {}): Props => ({
  zones,
  irrigationMode: "smart",
  aiScheduleEnabled: true,
  refreshKey: 0,
  onModeChanged: vi.fn(),
  onScheduleChanged: vi.fn(),
  onOpenSmartSettings: vi.fn(),
  onOpenProgramSettings: vi.fn(),
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchAIScheduleConfig).mockResolvedValue(aiScheduleConfig);
  vi.mocked(api.fetchMaterializedProgramEntries).mockResolvedValue([]);
  vi.mocked(api.updateSystemConfig).mockResolvedValue({ irrigationMode: "scheduled" });
  // fetchPrograms is called by both modes with different filters; branch on it.
  vi.mocked(api.fetchPrograms).mockImplementation(async (filter) => {
    if (filter?.source === "ai-schedule") return [aiProgram];
    if (filter?.source === "manual") return [manualProgram];
    return [];
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IrrigationQueuePanel", () => {
  it("in smart mode fetches only the smart data and renders the smart UI", async () => {
    renderWithProviders(
      <IrrigationQueuePanel {...baseProps({ irrigationMode: "smart", aiScheduleEnabled: true })} />
    );

    // Smart heading + the AI program from the smart query render.
    expect(await screen.findByText("Smart Irrigation")).toBeInTheDocument();
    expect(await screen.findByText("AI Morning")).toBeInTheDocument();

    // Smart-mode fetches fired...
    expect(api.fetchAIScheduleConfig).toHaveBeenCalled();
    expect(api.fetchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ai-schedule" })
    );
    // ...and the scheduled-mode fetch did NOT.
    expect(api.fetchMaterializedProgramEntries).not.toHaveBeenCalled();
    expect(api.fetchPrograms).not.toHaveBeenCalledWith(
      expect.objectContaining({ source: "manual" })
    );
  });

  it("in scheduled mode (aiScheduleEnabled=false) fetches only the scheduled data and renders the scheduled UI", async () => {
    renderWithProviders(
      <IrrigationQueuePanel {...baseProps({ aiScheduleEnabled: false })} />
    );

    expect(await screen.findByText("Programmed Irrigation")).toBeInTheDocument();
    expect(await screen.findByText("Front Lawn")).toBeInTheDocument();
    expect(screen.getByText("1 active program")).toBeInTheDocument();

    expect(api.fetchMaterializedProgramEntries).toHaveBeenCalled();
    expect(api.fetchPrograms).toHaveBeenCalledWith(
      expect.objectContaining({ source: "manual" })
    );
    expect(api.fetchAIScheduleConfig).not.toHaveBeenCalled();
  });

  it("treats irrigationMode='scheduled' as scheduled mode even when aiScheduleEnabled is true", async () => {
    renderWithProviders(
      <IrrigationQueuePanel
        {...baseProps({ irrigationMode: "scheduled", aiScheduleEnabled: true })}
      />
    );

    expect(await screen.findByText("Programmed Irrigation")).toBeInTheDocument();
    expect(api.fetchMaterializedProgramEntries).toHaveBeenCalled();
    expect(api.fetchAIScheduleConfig).not.toHaveBeenCalled();
  });

  it("refetches the active mode's data when refreshKey changes", async () => {
    const { rerender } = renderWithProviders(
      <IrrigationQueuePanel {...baseProps({ refreshKey: 1 })} />
    );

    await waitFor(() => expect(api.fetchAIScheduleConfig).toHaveBeenCalledTimes(1));

    rerender(<IrrigationQueuePanel {...baseProps({ refreshKey: 2 })} />);

    // A new refreshKey changes the queryKey, so the smart query runs again.
    await waitFor(() => expect(api.fetchAIScheduleConfig).toHaveBeenCalledTimes(2));
  });

  it("the mode-toggle switches to scheduled via updateSystemConfig + onModeChanged", async () => {
    const onModeChanged = vi.fn();
    renderWithProviders(
      <IrrigationQueuePanel
        {...baseProps({ irrigationMode: "smart", aiScheduleEnabled: true, onModeChanged })}
      />
    );

    // The toggle only renders when mode switching is allowed (aiScheduleEnabled).
    const scheduledRadio = await screen.findByRole("radio", { name: "Scheduled programs" });
    await userEvent.click(scheduledRadio);

    await waitFor(() => expect(api.updateSystemConfig).toHaveBeenCalledWith("scheduled"));
    await waitFor(() =>
      expect(onModeChanged).toHaveBeenCalledWith<[IrrigationMode]>("scheduled")
    );
  });

  it("routes the settings gear to the smart settings handler in smart mode", async () => {
    const onOpenSmartSettings = vi.fn();
    renderWithProviders(
      <IrrigationQueuePanel {...baseProps({ onOpenSmartSettings })} />
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Configure AI scheduling" })
    );
    expect(onOpenSmartSettings).toHaveBeenCalledOnce();
  });
});
