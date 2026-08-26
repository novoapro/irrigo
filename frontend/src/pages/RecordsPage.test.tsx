import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import type { Heartbeat, HeartbeatListResponse } from "../types";

/**
 * Behavioral characterization tests for RecordsPage after its migration from
 * manual fetch+useState+useEffect to a TanStack Query `useQuery`. These lock in
 * the observable contract: what renders, how filters translate into
 * `fetchHeartbeats` query args (including the DEBOUNCED psi filter), and the
 * delete → refetch flow. Only the "../api" module is mocked; the real
 * HistorySection renders so we assert on genuine output.
 */

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    fetchHeartbeats: vi.fn(),
    deleteHeartbeats: vi.fn()
  };
});

import RecordsPage from "./RecordsPage";
import { deleteHeartbeats, fetchHeartbeats } from "../api";

const mockFetch = vi.mocked(fetchHeartbeats);
const mockDelete = vi.mocked(deleteHeartbeats);

const makeHeartbeat = (overrides: Partial<Heartbeat> = {}): Heartbeat => ({
  _id: "hb-1",
  guard: true,
  sensors: { waterPsi: 45, rain: false, soil: false },
  device: {
    ip: "192.168.1.50",
    tempF: 70,
    humidity: 40,
    baselinePsi: 40,
    connectedSensors: ["PRESSURE", "RAIN", "SOIL"]
  },
  timestamp: "2026-08-01T12:00:00.000Z",
  weather: null,
  ...overrides
});

const makeResponse = (
  heartbeats: Heartbeat[],
  metaOverrides: Partial<HeartbeatListResponse["meta"]> = {}
): HeartbeatListResponse => ({
  data: heartbeats,
  meta: {
    page: 1,
    pageSize: 25,
    totalCount: heartbeats.length,
    totalPages: 2,
    hasNextPage: true,
    hasPreviousPage: false,
    ...metaOverrides
  }
});

// Open the labelled filter Dropdown and pick an option by its visible label.
const selectDropdown = async (label: string, option: string) => {
  const user = userEvent.setup();
  const group = screen
    .getByText(label, { selector: "label" })
    .closest(".records-filter-group") as HTMLElement;
  await user.click(within(group).getByRole("button"));
  await user.click(await screen.findByRole("button", { name: option }));
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue(makeResponse([makeHeartbeat()]));
  mockDelete.mockResolvedValue({ deletedCount: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RecordsPage", () => {
  it("renders fetched heartbeats and the record count", async () => {
    renderWithProviders(<RecordsPage />);

    // PSI value from the fixture is rendered by HistorySection (45 -> "45.0"),
    // in both the table and card views.
    expect((await screen.findAllByText("45.0")).length).toBeGreaterThan(0);
    expect(screen.getByText("1 record found")).toBeInTheDocument();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 25 })
    );
  });

  it("shows the empty state when no heartbeats are returned", async () => {
    mockFetch.mockResolvedValue(makeResponse([], { totalCount: 0, totalPages: 1, hasNextPage: false }));
    renderWithProviders(<RecordsPage />);

    expect(
      await screen.findByText("No heartbeat data available for this range.")
    ).toBeInTheDocument();
    expect(screen.getByText("0 records found")).toBeInTheDocument();
  });

  it("surfaces a query error in the error banner", async () => {
    mockFetch.mockRejectedValue(new Error("boom"));
    renderWithProviders(<RecordsPage />);

    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("debounces the psi filter: typing does not refetch until the debounce elapses", async () => {
    renderWithProviders(<RecordsPage />);
    await screen.findAllByText("45.0");

    mockFetch.mockClear();

    const group = screen.getByText("PSI min").closest(".records-filter-group") as HTMLElement;
    const psiInput = within(group).getByRole("spinbutton");
    fireEvent.change(psiInput, { target: { value: "20" } });

    // Immediately after typing the query key still holds the old (empty) psi,
    // so no refetch has been issued yet — this is the debounce guard.
    expect(mockFetch).not.toHaveBeenCalled();

    // Once the 400ms debounce elapses the query refetches with the psi arg.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ psiMin: "20", page: 1 })
      );
    });
  });

  it("refetches with the guard filter arg when the guard dropdown changes", async () => {
    renderWithProviders(<RecordsPage />);
    await screen.findAllByText("45.0");
    mockFetch.mockClear();

    await selectDropdown("Guard", "On");

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ guard: "true" })
      );
    });
  });

  it("refetches the next page when pagination advances", async () => {
    renderWithProviders(<RecordsPage />);
    await screen.findAllByText("45.0");
    mockFetch.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: ">" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 })
      );
    });
  });

  it("deletes heartbeats then refetches the list", async () => {
    renderWithProviders(<RecordsPage />);
    await screen.findAllByText("45.0");
    mockFetch.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Delete all records"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
    // invalidateQueries(["records"]) triggers a fresh fetch after deletion.
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  });
});
