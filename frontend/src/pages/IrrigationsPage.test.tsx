import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import type {
  HeartbeatListMeta,
  IrrigationRecord,
  IrrigationRecordListResponse,
  Zone
} from "../types";

/**
 * Behavioral characterization tests for IrrigationsPage after its migration to
 * TanStack Query. Locks in: record rendering, zone/source filters + pagination
 * translating into `fetchIrrigationRecords` args, and the delete → refetch flow.
 * Zones come from the real `useZonesQuery`, so `fetchZones` is mocked too.
 */

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    fetchIrrigationRecords: vi.fn(),
    deleteIrrigationRecords: vi.fn(),
    fetchZones: vi.fn()
  };
});

import IrrigationsPage from "./IrrigationsPage";
import {
  deleteIrrigationRecords,
  fetchIrrigationRecords,
  fetchZones
} from "../api";

const mockFetch = vi.mocked(fetchIrrigationRecords);
const mockDelete = vi.mocked(deleteIrrigationRecords);
const mockZones = vi.mocked(fetchZones);

const makeZone = (): Zone => ({
  zoneId: "zone-a",
  name: "Front Lawn",
  enabled: true,
  sortOrder: 0,
  defaultDurationMinutes: 10,
  maxDurationMinutes: 30
});

const makeRecord = (overrides: Partial<IrrigationRecord> = {}): IrrigationRecord => ({
  _id: "rec-1",
  zoneId: "zone-a",
  source: "manual",
  status: "completed",
  startedAt: "2026-08-01T12:00:00.000Z",
  endedAt: "2026-08-01T12:10:00.000Z",
  durationMs: 600000,
  pressureStart: 42.5,
  pressureEnd: 41.2,
  createdAt: "2026-08-01T12:00:00.000Z",
  ...overrides
});

const meta = (overrides: Partial<HeartbeatListMeta> = {}): HeartbeatListMeta => ({
  page: 1,
  pageSize: 25,
  totalCount: 1,
  totalPages: 2,
  hasNextPage: true,
  hasPreviousPage: false,
  ...overrides
});

const makeResponse = (
  records: IrrigationRecord[],
  metaOverrides: Partial<HeartbeatListMeta> = {}
): IrrigationRecordListResponse => ({
  data: records,
  meta: meta({ totalCount: records.length, ...metaOverrides })
});

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
  mockZones.mockResolvedValue([makeZone()]);
  mockFetch.mockResolvedValue(makeResponse([makeRecord()]));
  mockDelete.mockResolvedValue({ deletedCount: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IrrigationsPage", () => {
  it("renders fetched records with resolved zone names", async () => {
    renderWithProviders(<IrrigationsPage />);

    // Zone name resolved from the zones query; appears in table + card views.
    expect((await screen.findAllByText("Front Lawn")).length).toBeGreaterThan(0);
    expect(screen.getByText("1 record found")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, pageSize: 25 })
    );
  });

  it("shows the empty state when no records are returned", async () => {
    mockFetch.mockResolvedValue(makeResponse([], { totalCount: 0, totalPages: 1, hasNextPage: false }));
    renderWithProviders(<IrrigationsPage />);

    expect(
      await screen.findByText("No irrigation records available for this range.")
    ).toBeInTheDocument();
  });

  it("refetches with zoneId when the zone filter changes", async () => {
    renderWithProviders(<IrrigationsPage />);
    await screen.findAllByText("Front Lawn");
    mockFetch.mockClear();

    await selectDropdown("Zone", "Front Lawn");

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ zoneId: "zone-a" })
      )
    );
  });

  it("refetches with source when the source filter changes", async () => {
    renderWithProviders(<IrrigationsPage />);
    await screen.findAllByText("Front Lawn");
    mockFetch.mockClear();

    await selectDropdown("Source", "Program");

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({ source: "program" })
      )
    );
  });

  it("refetches the next page when pagination advances", async () => {
    renderWithProviders(<IrrigationsPage />);
    await screen.findAllByText("Front Lawn");
    mockFetch.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: ">" }));

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }))
    );
  });

  it("deletes records then refetches the list", async () => {
    renderWithProviders(<IrrigationsPage />);
    await screen.findAllByText("Front Lawn");
    mockFetch.mockClear();

    const user = userEvent.setup();
    await user.click(screen.getByTitle("Delete all records"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  });
});
