import { useCallback, useEffect, useRef, useState } from "react";
import { fetchHeartbeats, type HeartbeatQuery } from "../api";
import type { Heartbeat, HeartbeatListMeta } from "../types";
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
  const [heartbeats, setHeartbeats] = useState<Heartbeat[]>([]);
  const [meta, setMeta] = useState<HeartbeatListMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters);

  const mountedRef = useRef(true);
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

  const loadRecords = useCallback(
    async (p: number, f: Filters, psi: { psiMin: string; psiMax: string }, start: Date | null, end: Date | null) => {
      setLoading(true);
      setError(null);
      try {
        const query: HeartbeatQuery = {
          page: p,
          pageSize: PAGE_SIZE,
          start: start ? toQueryDateTime(start) : undefined,
          end: end ? toQueryDateTime(end) : undefined
        };
        if (f.guard !== "all") query.guard = f.guard as "true" | "false";
        if (f.rain !== "all") query.rain = f.rain as "true" | "false";
        if (f.soil !== "all") query.soil = f.soil as "true" | "false";
        if (psi.psiMin.trim()) query.psiMin = psi.psiMin.trim();
        if (psi.psiMax.trim()) query.psiMax = psi.psiMax.trim();

        const result = await fetchHeartbeats(query);
        if (!mountedRef.current) return;
        setHeartbeats(result.data);
        setMeta(result.meta);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load records");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    loadRecords(page, filters, debouncedPsi, startDate, endDate);
  }, [page, filters.guard, filters.rain, filters.soil, debouncedPsi, startDate, endDate, loadRecords]);

  const totalPages = meta?.totalPages ?? 1;
  const totalCount = meta?.totalCount ?? heartbeats.length;

  const handleResetFilters = () => {
    setFilters(defaultFilters);
    setDebouncedPsi({ psiMin: "", psiMax: "" });
    setStartDate(null);
    setEndDate(null);
    setPage(1);
  };

  const hasActiveFilters =
    startDate !== null ||
    endDate !== null ||
    filters.guard !== "all" ||
    filters.rain !== "all" ||
    filters.soil !== "all" ||
    filters.psiMin !== "" ||
    filters.psiMax !== "";

  return (
    <div className="records-page">
      <header className="records-page__header">
        <h2>Heartbeats</h2>
        <p className="muted">
          {totalCount} record{totalCount === 1 ? "" : "s"} found
        </p>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

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
    </div>
  );
};

export default RecordsPage;
