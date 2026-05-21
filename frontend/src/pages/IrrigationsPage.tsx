import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIrrigationRecords, fetchZones, type IrrigationRecordQuery } from "../api";
import type { IrrigationRecord, IrrigationSource, Zone } from "../types";
import type { HeartbeatListMeta } from "../types";
import Dropdown from "../components/Dropdown";
import DateTimeInput from "../components/DateTimeInput";
import { formatTimestamp, formatDurationLabel, toQueryDateTime } from "../utils/date";

const PAGE_SIZE = 25;

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "manual", label: "Manual" },
  { value: "program", label: "Program" },
  { value: "ai-schedule", label: "AI Schedule" }
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" }
];

const sourceLabel = (source: IrrigationSource) => {
  if (source === "ai-schedule") return "AI Schedule";
  return source.charAt(0).toUpperCase() + source.slice(1);
};

const IrrigationsPage = () => {
  const [records, setRecords] = useState<IrrigationRecord[]>([]);
  const [meta, setMeta] = useState<HeartbeatListMeta | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [zoneFilter, setZoneFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    fetchZones().then(setZones).catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  const loadRecords = useCallback(
    async (p: number, start: Date | null, end: Date | null, zone: string, source: string) => {
      setLoading(true);
      setError(null);
      try {
        const query: IrrigationRecordQuery = {
          page: p,
          pageSize: PAGE_SIZE,
          start: start ? toQueryDateTime(start) : undefined,
          end: end ? toQueryDateTime(end) : undefined
        };
        if (zone !== "all") query.zoneId = zone;
        if (source !== "all") query.source = source;

        const result = await fetchIrrigationRecords(query);
        if (!mountedRef.current) return;
        setRecords(result.data);
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
    loadRecords(page, startDate, endDate, zoneFilter, sourceFilter);
  }, [page, startDate, endDate, zoneFilter, sourceFilter, loadRecords]);

  const totalPages = meta?.totalPages ?? 1;
  const totalCount = meta?.totalCount ?? records.length;

  const hasActiveFilters =
    startDate !== null ||
    endDate !== null ||
    zoneFilter !== "all" ||
    sourceFilter !== "all";

  const handleReset = () => {
    setStartDate(null);
    setEndDate(null);
    setZoneFilter("all");
    setSourceFilter("all");
    setPage(1);
  };

  const zoneOptions = [
    { value: "all", label: "All zones" },
    ...zones.map((z) => ({ value: z.zoneId, label: z.name }))
  ];

  const zoneName = (zoneId: string) => {
    const z = zones.find((zone) => zone.zoneId === zoneId);
    return z?.name ?? zoneId;
  };

  const formatPsi = (val: number | null | undefined) =>
    val != null ? `${val.toFixed(1)} psi` : "—";

  return (
    <div className="records-page">
      <header className="records-page__header">
        <h2>Irrigations</h2>
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
            <label>Zone</label>
            <Dropdown
              value={zoneFilter}
              options={zoneOptions}
              onChange={(v) => { setZoneFilter(v); setPage(1); }}
            />
          </div>
          <div className="records-filter-group">
            <label>Source</label>
            <Dropdown
              value={sourceFilter}
              options={SOURCE_OPTIONS}
              onChange={(v) => { setSourceFilter(v); setPage(1); }}
            />
          </div>
        </div>

        {hasActiveFilters && (
          <div className="records-filters__actions">
            <button
              type="button"
              className="filter-reset-icon"
              onClick={handleReset}
              title="Reset filters"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        )}
      </div>

      <section className="history-panel">
        <header className="history-header">
          <h3>Records</h3>
          <span className="history-header-subtitle muted">
            Showing {records.length} of {totalCount} record
            {totalCount === 1 ? "" : "s"} &bull; Page {page} of {totalPages}
          </span>
        </header>

        {totalCount === 0 ? (
          <p className="muted">No irrigation records available for this range.</p>
        ) : (
          <div className={`history-content${loading ? " history-content--loading" : ""}`}>
            <div className="table-wrapper history-table-wrapper">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Started</th>
                    <th>Zone</th>
                    <th>Source</th>
                    <th>Duration</th>
                    <th>PSI Start</th>
                    <th>PSI End</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r._id}>
                      <td>{formatTimestamp(r.startedAt)}</td>
                      <td>{zoneName(r.zoneId)}</td>
                      <td>
                        <span className={`source-chip source-chip--${r.source}`}>
                          {sourceLabel(r.source)}
                        </span>
                      </td>
                      <td>{r.durationMs != null ? formatDurationLabel(r.durationMs) : "—"}</td>
                      <td>{formatPsi(r.pressureStart)}</td>
                      <td>{formatPsi(r.pressureEnd)}</td>
                      <td>
                        <span className={`irrigation-status irrigation-status--${r.status}`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="history-cards">
              {records.map((r) => (
                <article key={`card-${r._id}`} className="history-card">
                  <header className="history-card-header">
                    <div>
                      <span className="history-card-label">Started</span>
                      <span className="history-card-timestamp">{formatTimestamp(r.startedAt)}</span>
                    </div>
                    <span className={`irrigation-status irrigation-status--${r.status}`}>
                      {r.status}
                    </span>
                  </header>
                  <dl className="history-card-metrics">
                    <div>
                      <dt>Zone</dt>
                      <dd>{zoneName(r.zoneId)}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>
                        <span className={`source-chip source-chip--${r.source}`}>
                          {sourceLabel(r.source)}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{r.durationMs != null ? formatDurationLabel(r.durationMs) : "—"}</dd>
                    </div>
                    <div>
                      <dt>PSI</dt>
                      <dd>{formatPsi(r.pressureStart)}{r.pressureEnd != null ? ` → ${formatPsi(r.pressureEnd)}` : ""}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            <div className="pagination-controls">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!(meta?.hasPreviousPage ?? page > 1)}
              >
                &lt;
              </button>
              <span className="muted pagination-status">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="ghost-button"
                onClick={() => setPage((p) => p + 1)}
                disabled={!(meta?.hasNextPage ?? page < totalPages)}
              >
                &gt;
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default IrrigationsPage;
