import { useCallback, useEffect, useRef, useState } from "react";
import ReactDatePicker from "react-datepicker";
import { fetchHeartbeats, type HeartbeatQuery } from "../api";
import type { Heartbeat, HeartbeatListMeta } from "../types";
import HistorySection from "../components/HistorySection";
import Dropdown from "../components/Dropdown";
import { toQueryDateTime } from "../utils/date";
import "react-datepicker/dist/react-datepicker.css";

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
  const [appliedFilters, setAppliedFilters] = useState<Filters>(defaultFilters);

  const mountedRef = useRef(true);

  const loadRecords = useCallback(
    async (p: number, f: Filters, start: Date | null, end: Date | null) => {
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
        if (f.psiMin.trim()) query.psiMin = f.psiMin.trim();
        if (f.psiMax.trim()) query.psiMax = f.psiMax.trim();

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
    loadRecords(page, appliedFilters, startDate, endDate);
  }, [page, appliedFilters, startDate, endDate, loadRecords]);

  const totalPages = meta?.totalPages ?? 1;
  const totalCount = meta?.totalCount ?? heartbeats.length;

  const handleApplyFilters = () => {
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const handleResetFilters = () => {
    setFilters(defaultFilters);
    setAppliedFilters(defaultFilters);
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

  const handleFilterKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleApplyFilters();
  };

  return (
    <div className="records-page">
      <header className="records-page__header">
        <h2>Records</h2>
        <p className="muted">
          {totalCount} record{totalCount === 1 ? "" : "s"} found
        </p>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="records-filters">
        <div className="records-filters__row">
          <div className="records-filter-group">
            <label>From</label>
            <ReactDatePicker
              selected={startDate}
              onChange={(d: Date | null) => { setStartDate(d); setPage(1); }}
              selectsStart
              startDate={startDate}
              endDate={endDate}
              maxDate={endDate ?? new Date()}
              showTimeSelect
              timeIntervals={15}
              placeholderText="Any"
              className="date-input"
              dateFormat="MMM d, yyyy h:mm aa"
              isClearable
            />
          </div>
          <div className="records-filter-group">
            <label>To</label>
            <ReactDatePicker
              selected={endDate}
              onChange={(d: Date | null) => { setEndDate(d); setPage(1); }}
              selectsEnd
              startDate={startDate}
              endDate={endDate}
              minDate={startDate ?? undefined}
              maxDate={new Date()}
              showTimeSelect
              timeIntervals={15}
              placeholderText="Now"
              className="date-input"
              dateFormat="MMM d, yyyy h:mm aa"
              isClearable
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
              onChange={(v) => setFilters((f) => ({ ...f, guard: v as BoolFilter }))}
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
              onChange={(v) => setFilters((f) => ({ ...f, rain: v as BoolFilter }))}
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
              onChange={(v) => setFilters((f) => ({ ...f, soil: v as BoolFilter }))}
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
              onKeyDown={handleFilterKeyDown}
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
              onKeyDown={handleFilterKeyDown}
              placeholder="Any"
              className="records-filter-input"
            />
          </div>
        </div>

        <div className="records-filters__actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleApplyFilters}
          >
            Apply filters
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={handleResetFilters}
            disabled={!hasActiveFilters}
          >
            Reset
          </button>
        </div>
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
