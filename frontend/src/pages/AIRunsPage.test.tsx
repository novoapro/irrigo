import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import type { HeartbeatListMeta, ScheduleEntry, ScheduleRun } from "../types";

/**
 * Behavioral characterization tests for AIRunsPage after its migration to
 * TanStack Query. Locks in: list rendering, pagination refetch, lazy-loading a
 * run's detail via `fetchScheduleRun` on expand, and the delete → refetch flow.
 */

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    fetchScheduleRuns: vi.fn(),
    fetchScheduleRun: vi.fn(),
    deleteScheduleRuns: vi.fn()
  };
});

import AIRunsPage from "./AIRunsPage";
import { deleteScheduleRuns, fetchScheduleRun, fetchScheduleRuns } from "../api";

const mockFetchRuns = vi.mocked(fetchScheduleRuns);
const mockFetchRun = vi.mocked(fetchScheduleRun);
const mockDelete = vi.mocked(deleteScheduleRuns);

const makeRun = (overrides: Partial<ScheduleRun> = {}): ScheduleRun => ({
  scheduleRunId: "run-1",
  triggeredBy: "cron",
  status: "completed",
  aiProvider: "anthropic",
  aiModel: "claude-sonnet-test",
  entries: 2,
  reasoning: "Soil is dry; watering recommended.",
  startedAt: "2026-08-01T09:00:00.000Z",
  completedAt: "2026-08-01T09:01:00.000Z",
  ...overrides
});

const makeEntry = (overrides: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  _id: "entry-1",
  scheduleRunId: "run-1",
  zoneId: "zone-a",
  plannedStartAt: "2026-08-01T18:00:00.000Z",
  plannedDurationMinutes: 12,
  status: "planned",
  aiReasoning: "Dry zone",
  weatherContext: {
    precipitationProbability: 5,
    forecastSummary: "Clear",
    recentRainDetected: false
  },
  createdAt: "2026-08-01T09:00:00.000Z",
  updatedAt: "2026-08-01T09:00:00.000Z",
  ...overrides
});

const meta = (overrides: Partial<HeartbeatListMeta> = {}): HeartbeatListMeta => ({
  page: 1,
  pageSize: 20,
  totalCount: 1,
  totalPages: 2,
  hasNextPage: true,
  hasPreviousPage: false,
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchRuns.mockResolvedValue({ data: [makeRun()], meta: meta() });
  // fetchScheduleRun's declared return type intersects ScheduleRun (entries:
  // number) with { entries: ScheduleEntry[] }, so cast the detail fixture.
  mockFetchRun.mockResolvedValue({
    ...makeRun(),
    entries: [makeEntry()]
  } as unknown as Awaited<ReturnType<typeof fetchScheduleRun>>);
  mockDelete.mockResolvedValue({ deletedCount: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AIRunsPage", () => {
  it("renders fetched runs and the run count", async () => {
    renderWithProviders(<AIRunsPage />);

    expect(await screen.findByText("claude-sonnet-test")).toBeInTheDocument();
    expect(screen.getByText("1 run found")).toBeInTheDocument();
    expect(mockFetchRuns).toHaveBeenCalledWith(1, {});
  });

  it("shows the empty state when no runs are returned", async () => {
    mockFetchRuns.mockResolvedValue({
      data: [],
      meta: meta({ totalCount: 0, totalPages: 1, hasNextPage: false })
    });
    renderWithProviders(<AIRunsPage />);

    expect(await screen.findByText("No AI runs found.")).toBeInTheDocument();
  });

  it("refetches the next page when pagination advances", async () => {
    renderWithProviders(<AIRunsPage />);
    await screen.findByText("claude-sonnet-test");
    mockFetchRuns.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: ">" }));

    await waitFor(() => expect(mockFetchRuns).toHaveBeenCalledWith(2, {}));
  });

  it("lazy-loads a run's detail via fetchScheduleRun when expanded", async () => {
    renderWithProviders(<AIRunsPage />);
    const modelLabel = await screen.findByText("claude-sonnet-test");

    // Detail is not fetched until the card is expanded.
    expect(mockFetchRun).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(modelLabel.closest("button") as HTMLElement);

    await waitFor(() => expect(mockFetchRun).toHaveBeenCalledWith("run-1"));
    // The lazily-loaded entry renders once the detail resolves.
    expect(await screen.findByText("Entries Created")).toBeInTheDocument();
    expect(screen.getByText("12 min")).toBeInTheDocument();
  });

  it("deletes runs then refetches the list", async () => {
    renderWithProviders(<AIRunsPage />);
    await screen.findByText("claude-sonnet-test");
    mockFetchRuns.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Delete all runs"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockFetchRuns).toHaveBeenCalled());
  });
});
