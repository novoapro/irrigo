import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { deleteHeartbeats, fetchHeartbeats, type HeartbeatQuery } from "../api";
import type { HeartbeatListResponse } from "../types";
import HistorySection from "../components/HistorySection";
import Dropdown from "../components/Dropdown";
import DateTimeInput from "../components/DateTimeInput";
import { toQueryDateTime } from "../utils/date";

const PAGE_SIZE = 25;

type BoolFilter = "all" | "true" | "false";

interface Filters {
  guard: BoolFilter;
  rain: BoolFilter;
  soil: BoolFilter;
  psiMin: string;
  psiMax: string;
}

const defaultFilters: Filters = {
  guard: "all",
  rain: "all",
  soil: "all",
  psiMin: "",
  psiMax: ""
};

const RecordsPage = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);

  const psiDebounceRef = useRef<number | null>(null);
  const [debouncedPsi, setDebouncedPsi] = useState({ psiMin: "", psiMax: "" });

  useEffect(() => {
    if (psiDebounceRef.current) clearTimeout(psiDebounceRef.current);
    psiDebounceRef.current = window.setTimeout(() => {
      setDebouncedPsi({ psiMin: filters.psiMin, psiMax: filters.psiMax });
      setPage(1);
    }, 400);
    return () => { if (psiDebounceRef.current) clearTimeout(psiDebounceRef.current); };
  }, [filters.psiMin, filters.psiMax]);

  const start = startDate ? toQueryDateTime(startDate) : undefined;
  const end = endDate ? toQueryDateTime(endDate) : undefined;

  const query = useQuery({
    queryKey: [
      "records",
      {
        page,
        guard: filters.guard,
        rain: filters.rain,
        soil: filters.soil,
        psiMin: debouncedPsi.psiMin,
        psiMax: debouncedPsi.psiMax,
        start,
        end
      }
    ],
    queryFn: async (): Promise<HeartbeatListResponse | null> => {
      const q: HeartbeatQuery = {
        page,
        pageSize: PAGE_SIZE,
        start,
        end
      };
      if (filters.guard !== "all") q.guard = filters.guard as "true" | "false";
      if (filters.rain !== "all") q.rain = filters.rain as "true" | "false";
      if (filters.soil !== "all") q.soil = filters.soil as "true" | "false";
      if (debouncedPsi.psiMin.trim()) q.psiMin = debouncedPsi.psiMin.trim();
      if (debouncedPsi.psiMax.trim()) q.psiMax = debouncedPsi.psiMax.trim();
      return (await fetchHeartbeats(q)) ?? null;
    }
  });

  const heartbeats = query.data?.data ?? [];
  const meta = query.data?.meta ?? null;
  const loading = query.isLoading;
  const [error, setError] = useState<string | null>(null);
  const queryError = query.error
    ? query.error instanceof Error
      ? query.error.message
      : "Failed to load records"
    : null;
  const displayError = error ?? queryError;

  const totalPages = meta?.totalPages ?? 1;
  const totalCount = meta?.totalCount ?? heartbeats.length;

  const handleResetFilters = () => {
    setFilters(defaultFilters);
    setDebouncedPsi({ psiMin: "", psiMax: "" });
    setStartDate(null);
    setEndDate(null);
    setPage(1);
  };

  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasActiveFilters =
    startDate !== null ||
    endDate !== null ||
    filters.guard !== "all" ||
    filters.rain !== "all" ||
    filters.soil !== "all" ||
    filters.psiMin !== "" ||
    filters.psiMax !== "";

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const query: Omit<HeartbeatQuery, "page" | "pageSize"> = {};
      if (startDate) query.start = toQueryDateTime(startDate);
      if (endDate) query.end = toQueryDateTime(endDate);
      if (filters.guard !== "all") query.guard = filters.guard as "true" | "false";
      if (filters.rain !== "all") query.rain = filters.rain as "true" | "false";
      if (filters.soil !== "all") query.soil = filters.soil as "true" | "false";
      if (debouncedPsi.psiMin.trim()) query.psiMin = debouncedPsi.psiMin.trim();
      if (debouncedPsi.psiMax.trim()) query.psiMax = debouncedPsi.psiMax.trim();
      await deleteHeartbeats(query);
      setConfirmDelete(false);
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ["records"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete records");
    } finally {
      setDeleting(false);
    }
  }, [startDate, endDate, filters, debouncedPsi, queryClient]);

  return (
    <div className="records-page">
      <header className="records-page__header">
        <div>
          <h2>Heartbeats</h2>
          <p className="muted">
            {totalCount} record{totalCount === 1 ? "" : "s"} found
          </p>
        </div>
        {totalCount > 0 && (
          <button
            type="button"
            className="records-delete-btn"
            onClick={() => setConfirmDelete(true)}
            title={hasActiveFilters ? "Delete filtered records" : "Delete all records"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </button>
        )}
      </header>

      {displayError ? <div className="error-banner">{displayError}</div> : null}

      <div className="records-filters records-filters--no-border">
        <div className="records-filters__row">
          <div className="records-filter-group">
            <label>From</label>
            <DateTimeInput
              value={startDate}
              onChange={(d) => { setStartDate(d); setPage(1); }}
              max={endDate ?? new Date()}
              placeholder="Any"
              clearable
            />
          </div>
          <div className="records-filter-group">
            <label>To</label>
            <DateTimeInput
              value={endDate}
              onChange={(d) => { setEndDate(d); setPage(1); }}
              min={startDate ?? undefined}
              max={new Date()}
              placeholder="Now"
              clearable
            />
          </div>
        </div>

        <div className="records-filters__row records-filters__row--selects">
          <div className="records-filter-group">
            <label>Guard</label>
            <Dropdown
              value={filters.guard}
              options={[
                { value: "all", label: "All" },
                { value: "true", label: "On" },
                { value: "false", label: "Off" }
              ]}
              onChange={(v) => { setFilters((f) => ({ ...f, guard: v as BoolFilter })); setPage(1); }}
            />
          </div>
          <div className="records-filter-group">
            <label>Rain</label>
            <Dropdown
              value={filters.rain}
              options={[
                { value: "all", label: "All" },
                { value: "true", label: "Detected" },
                { value: "false", label: "No rain" }
              ]}
              onChange={(v) => { setFilters((f) => ({ ...f, rain: v as BoolFilter })); setPage(1); }}
            />
          </div>
          <div className="records-filter-group">
            <label>Soil</label>
            <Dropdown
              value={filters.soil}
              options={[
                { value: "all", label: "All" },
                { value: "true", label: "Saturated" },
                { value: "false", label: "Dry" }
              ]}
              onChange={(v) => { setFilters((f) => ({ ...f, soil: v as BoolFilter })); setPage(1); }}
            />
          </div>
        </div>

        <div className="records-filters__row records-filters__row--psi">
          <div className="records-filter-group">
            <label>PSI min</label>
            <input
              type="number"
              step="0.1"
              value={filters.psiMin}
              onChange={(e) => setFilters((f) => ({ ...f, psiMin: e.target.value }))}
              placeholder="Any"
              className="records-filter-input"
            />
          </div>
          <div className="records-filter-group">
            <label>PSI max</label>
            <input
              type="number"
              step="0.1"
              value={filters.psiMax}
              onChange={(e) => setFilters((f) => ({ ...f, psiMax: e.target.value }))}
              placeholder="Any"
              className="records-filter-input"
            />
          </div>
        </div>

        {hasActiveFilters && (
          <div className="records-filters__actions">
            <button
              type="button"
              className="filter-reset-icon"
              onClick={handleResetFilters}
              title="Reset filters"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <HistorySection
        heartbeats={heartbeats}
        totalCount={totalCount}
        page={page}
        totalPages={totalPages}
        hasPreviousPage={meta?.hasPreviousPage ?? page > 1}
        hasNextPage={meta?.hasNextPage ?? page < totalPages}
        onPreviousPage={() => setPage((p) => Math.max(1, p - 1))}
        onNextPage={() => setPage((p) => p + 1)}
        isLoading={loading}
      />

      {confirmDelete && createPortal(
        <div className="modal-overlay confirm-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-dialog">
            <div className="confirm-dialog__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
            </div>
            <h3 className="confirm-dialog__title">Delete heartbeat records</h3>
            <p className="confirm-dialog__message">
              {hasActiveFilters
                ? <>This will permanently delete all <strong>{totalCount}</strong> heartbeat records matching your current filters.</>
                : <>This will permanently delete <strong>all {totalCount}</strong> heartbeat records.</>
              } This action cannot be undone.
            </p>
            <div className="confirm-dialog__actions">
              <button type="button" className="ghost-button" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default RecordsPage;
