import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { deleteIrrigationRecords, fetchIrrigationRecords, type IrrigationRecordQuery } from "../api";
import type { IrrigationRecordListResponse, IrrigationSource } from "../types";
import { useZonesQuery } from "../queries/dashboard";
import Dropdown from "../components/Dropdown";
import DateTimeInput from "../components/DateTimeInput";
import Pagination from "../components/Pagination";
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
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [zoneFilter, setZoneFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

  const zones = useZonesQuery().data ?? [];

  const start = startDate ? toQueryDateTime(startDate) : undefined;
  const end = endDate ? toQueryDateTime(endDate) : undefined;

  const query = useQuery({
    queryKey: [
      "irrigationRecordsPage",
      { page, start, end, zoneFilter, sourceFilter }
    ],
    queryFn: async (): Promise<IrrigationRecordListResponse | null> => {
      const q: IrrigationRecordQuery = {
        page,
        pageSize: PAGE_SIZE,
        start,
        end
      };
      if (zoneFilter !== "all") q.zoneId = zoneFilter;
      if (sourceFilter !== "all") q.source = sourceFilter;
      return (await fetchIrrigationRecords(q)) ?? null;
    }
  });

  const records = query.data?.data ?? [];
  const meta = query.data?.meta ?? null;
  const loading = query.isLoading;
  const queryError = query.error
    ? query.error instanceof Error
      ? query.error.message
      : "Failed to load records"
    : null;
  const displayError = error ?? queryError;

  const totalPages = meta?.totalPages ?? 1;
  const totalCount = meta?.totalCount ?? records.length;

  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasActiveFilters =
    startDate !== null ||
    endDate !== null ||
    zoneFilter !== "all" ||
    sourceFilter !== "all";

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const query: Omit<IrrigationRecordQuery, "page" | "pageSize"> = {};
      if (startDate) query.start = toQueryDateTime(startDate);
      if (endDate) query.end = toQueryDateTime(endDate);
      if (zoneFilter !== "all") query.zoneId = zoneFilter;
      if (sourceFilter !== "all") query.source = sourceFilter;
      await deleteIrrigationRecords(query);
      setConfirmDelete(false);
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ["irrigationRecordsPage"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete records");
    } finally {
      setDeleting(false);
    }
  }, [startDate, endDate, zoneFilter, sourceFilter, queryClient]);

  const handleReset = () => {
    setStartDate(null);
    setEndDate(null);
    setZoneFilter("all");
    setSourceFilter("all");
    setPage(1);
  };

  const zoneOptions = [
    { value: "all", label: "All" },
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
        <div>
          <h2>Irrigations</h2>
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

            {/* Shared pagination control; the ?? fallbacks preserve the
                original "trust server meta, else derive from page" logic. */}
            <Pagination
              page={page}
              totalPages={totalPages}
              hasPreviousPage={meta?.hasPreviousPage ?? page > 1}
              hasNextPage={meta?.hasNextPage ?? page < totalPages}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => p + 1)}
            />
          </div>
        )}
      </section>

      {confirmDelete && createPortal(
        <div className="modal-overlay confirm-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-dialog">
            <div className="confirm-dialog__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
            </div>
            <h3 className="confirm-dialog__title">Delete irrigation records</h3>
            <p className="confirm-dialog__message">
              {hasActiveFilters
                ? <>This will permanently delete all <strong>{totalCount}</strong> irrigation records matching your current filters.</>
                : <>This will permanently delete <strong>all {totalCount}</strong> irrigation records.</>
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

export default IrrigationsPage;
