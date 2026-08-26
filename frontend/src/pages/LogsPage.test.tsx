import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import type { IrrigationCommand, SequentialRun, WebhookEvent } from "../types";

/**
 * Behavioral characterization tests for LogsPage after its migration to
 * TanStack Query. The three tabs (controller logs / webhook events / sequential
 * runs) each own a `useQuery` gated by `enabled: activeTab === ...`, so only the
 * active tab's endpoint is fetched. These lock in that gating, tab switching,
 * and the delete → refetch flow on the commands tab. `fetchZones` backs the
 * real `useZonesQuery`, so it is mocked too.
 */

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    fetchControllerLogs: vi.fn(),
    fetchWebhookEvents: vi.fn(),
    fetchSequentialRuns: vi.fn(),
    deleteControllerLogs: vi.fn(),
    deleteWebhookEvents: vi.fn(),
    fetchZones: vi.fn()
  };
});

import LogsPage from "./LogsPage";
import {
  deleteControllerLogs,
  fetchControllerLogs,
  fetchSequentialRuns,
  fetchWebhookEvents,
  fetchZones
} from "../api";

const mockLogs = vi.mocked(fetchControllerLogs);
const mockEvents = vi.mocked(fetchWebhookEvents);
const mockRuns = vi.mocked(fetchSequentialRuns);
const mockDeleteLogs = vi.mocked(deleteControllerLogs);
const mockZones = vi.mocked(fetchZones);

const pagedMeta = {
  page: 1,
  pageSize: 25,
  totalCount: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false
};

const makeCommand = (): IrrigationCommand => ({
  _id: "cmd-1",
  zoneId: "zone-a",
  action: "on",
  durationMinutes: 10,
  source: "manual",
  status: "sent",
  createdAt: "2026-08-01T12:00:00.000Z"
});

const makeEvent = (): WebhookEvent => ({
  _id: "evt-1",
  deviceId: "dev-1",
  serviceId: "svc-1",
  characteristicId: "char-1",
  characteristicType: "active",
  oldValue: false,
  newValue: true,
  zoneId: "zone-a",
  zoneName: "Front Lawn",
  processed: true,
  receivedAt: "2026-08-01T12:00:00.000Z"
});

const makeRun = (): SequentialRun => ({
  _id: "run-1",
  source: "program",
  status: "completed",
  zones: [
    { zoneId: "zone-a", name: "Front Lawn", durationMinutes: 10, status: "completed" }
  ],
  currentZoneIndex: 0,
  startedAt: "2026-08-01T12:00:00.000Z",
  completedAt: "2026-08-01T12:10:00.000Z"
});

beforeEach(() => {
  vi.clearAllMocks();
  mockZones.mockResolvedValue([]);
  mockLogs.mockResolvedValue({ commands: [makeCommand()], meta: pagedMeta });
  mockEvents.mockResolvedValue({ events: [makeEvent()], meta: pagedMeta });
  mockRuns.mockResolvedValue({ data: [makeRun()], meta: pagedMeta });
  mockDeleteLogs.mockResolvedValue(undefined as unknown as void);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LogsPage", () => {
  it("fetches only the active (commands) tab on mount, not the gated tabs", async () => {
    renderWithProviders(<LogsPage />);

    expect(await screen.findByText("1 command found")).toBeInTheDocument();

    // Inactive tabs' queries are gated via `enabled` and must not fire.
    expect(mockEvents).not.toHaveBeenCalled();
    expect(mockRuns).not.toHaveBeenCalled();
  });

  it("fetches webhook events only after switching to the Incoming Events tab", async () => {
    renderWithProviders(<LogsPage />);
    await waitFor(() => expect(mockLogs).toHaveBeenCalled());
    expect(mockEvents).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Incoming Events" }));

    await waitFor(() => expect(mockEvents).toHaveBeenCalled());
    expect(await screen.findByText("1 event received")).toBeInTheDocument();
  });

  it("fetches sequential runs only after switching to the Program Runs tab", async () => {
    renderWithProviders(<LogsPage />);
    await waitFor(() => expect(mockLogs).toHaveBeenCalled());
    expect(mockRuns).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Program Runs" }));

    await waitFor(() => expect(mockRuns).toHaveBeenCalled());
    expect(await screen.findByText("1 run found")).toBeInTheDocument();
  });

  it("shows the empty state for the commands tab when no logs exist", async () => {
    mockLogs.mockResolvedValue({
      commands: [],
      meta: { ...pagedMeta, totalCount: 0 }
    });
    renderWithProviders(<LogsPage />);

    expect(
      await screen.findByText("No controller logs available for this range.")
    ).toBeInTheDocument();
  });

  it("deletes controller logs then refetches the commands tab", async () => {
    renderWithProviders(<LogsPage />);
    // The delete control only appears once logs have loaded (totalCount > 0).
    await screen.findByText("1 command found");
    mockLogs.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Delete all logs"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockDeleteLogs).toHaveBeenCalledTimes(1));
    // invalidateQueries(["controllerLogs"]) refetches the active tab.
    await waitFor(() => expect(mockLogs).toHaveBeenCalled());
  });
});
