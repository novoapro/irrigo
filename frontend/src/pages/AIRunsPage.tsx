import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { fetchScheduleRuns, fetchScheduleRun, deleteScheduleRuns } from "../api";
import type { HeartbeatListMeta, ScheduleEntry, ScheduleRun, Zone } from "../types";
import DateTimeInput from "../components/DateTimeInput";
import AIInteractionModal from "../components/AIInteractionModal";
import Pagination from "../components/Pagination";
import { toQueryDateTime } from "../utils/date";

const PAGE_SIZE = 20;

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
};

interface AIRunsPageProps {
  zones?: Zone[];
}

const AIRunsPage = ({ zones = [] }: AIRunsPageProps) => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<Record<string, { entries: ScheduleEntry[]; run: ScheduleRun }>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  const [interactionRun, setInteractionRun] = useState<ScheduleRun | null>(null);

  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const start = startDate ? toQueryDateTime(startDate) : undefined;
  const end = endDate ? toQueryDateTime(endDate) : undefined;

  const query = useQuery({
    queryKey: ["aiRuns", { page, start, end }],
    queryFn: async (): Promise<{ data: ScheduleRun[]; meta: HeartbeatListMeta } | null> => {
      const q: { start?: string; end?: string } = {};
      if (start) q.start = start;
      if (end) q.end = end;
      return (await fetchScheduleRuns(page, q)) ?? null;
    }
  });

  const runs = useMemo(() => query.data?.data ?? [], [query.data]);
  const meta = query.data?.meta ?? null;
  const loading = query.isLoading;
  const queryError = query.error
    ? query.error instanceof Error
      ? query.error.message
      : "Failed to load AI runs"
    : null;
  const displayError = error ?? queryError;

  const totalPages = meta?.totalPages ?? 1;
  const totalCount = meta?.totalCount ?? runs.length;

  const hasActiveFilters = startDate !== null || endDate !== null;

  const handleReset = () => {
    setStartDate(null);
    setEndDate(null);
    setPage(1);
  };

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const query: { start?: string; end?: string } = {};
      if (startDate) query.start = toQueryDateTime(startDate);
      if (endDate) query.end = toQueryDateTime(endDate);
      await deleteScheduleRuns(query);
      setConfirmDelete(false);
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ["aiRuns"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete runs");
    } finally {
      setDeleting(false);
    }
  }, [startDate, endDate, queryClient]);

  const handleToggleExpand = useCallback(async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (!runDetails[runId]) {
      setLoadingDetail(runId);
      try {
        const detail = await fetchScheduleRun(runId);
        setRunDetails((prev) => ({
          ...prev,
          [runId]: { entries: Array.isArray(detail.entries) ? detail.entries : [], run: detail }
        }));
      } catch {
        // The detail fetch failed; fall back to the summary row we already
        // have. Guard the lookup instead of asserting non-null (`!`) — if the
        // run isn't on the current page, leave the detail unset rather than
        // crash on an undefined `run`.
        const summary = runs.find((r) => r.scheduleRunId === runId);
        if (summary) {
          setRunDetails((prev) => ({ ...prev, [runId]: { entries: [], run: summary } }));
        }
      } finally {
        setLoadingDetail(null);
      }
    }
  }, [expandedRunId, runDetails, runs]);

  const handleViewInteraction = useCallback((runId: string) => {
    const detail = runDetails[runId];
    if (detail?.run) {
      setInteractionRun(detail.run);
    }
  }, [runDetails]);

  const getZoneName = (zoneId: string) => {
    const z = zones.find((zone) => zone.zoneId === zoneId);
    return z?.name ?? zoneId;
  };

  return (
    <div className="records-page">
      <header className="records-page__header">
        <div>
          <h2>AI Runs</h2>
          <p className="muted">
            {totalCount} run{totalCount === 1 ? "" : "s"} found
          </p>
        </div>
        {totalCount > 0 && (
          <button
            type="button"
            className="records-delete-btn"
            onClick={() => setConfirmDelete(true)}
            title={hasActiveFilters ? "Delete filtered runs" : "Delete all runs"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </button>
        )}
      </header>

      {displayError && <div className="error-banner">{displayError}</div>}

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

      {loading && runs.length === 0 ? (
        <p className="muted">Loading...</p>
      ) : runs.length === 0 ? (
        <p className="muted">No AI runs found.</p>
      ) : (
        <div className="ai-runs-list">
          {runs.map((run) => {
            const isExpanded = expandedRunId === run.scheduleRunId;
            const detail = runDetails[run.scheduleRunId];
            const isLoadingDetail = loadingDetail === run.scheduleRunId;
            return (
              <div className={`ai-run-card${isExpanded ? " ai-run-card--expanded" : ""}`} key={run.scheduleRunId}>
                <button
                  type="button"
                  className="ai-run-card__header"
                  onClick={() => void handleToggleExpand(run.scheduleRunId)}
                >
                  <span className={`schedule-status-pill schedule-status-pill--${run.status}`}>
                    {run.status}
                  </span>
                  <span className="ai-run-card__time">{formatDate(run.startedAt)}</span>
                  <span className="ai-run-card__meta muted">
                    {run.triggeredBy === "cron" ? "auto" : "manual"}
                    {typeof run.entries === "number" && run.entries > 0 ? ` · ${run.entries} zone${run.entries !== 1 ? "s" : ""}` : ""}
                    {run.promptTokens != null && ` · ${(run.promptTokens + (run.completionTokens ?? 0)).toLocaleString()} tokens`}
                  </span>
                  <span className="ai-run-card__provider muted">{run.aiModel}</span>
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className={`ai-run-card__chevron${isExpanded ? " ai-run-card__chevron--open" : ""}`}>
                    <path d="M6.293 7.293a1 1 0 011.414 0L10 9.586l2.293-2.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="ai-run-card__body">
                    {run.status === "error" && run.errorMessage && (
                      <div className="schedule-run__error">{run.errorMessage}</div>
                    )}
                    {run.reasoning && (
                      <p className="ai-run-card__reasoning">{run.reasoning}</p>
                    )}

                    {isLoadingDetail ? (
                      <p className="muted">Loading details...</p>
                    ) : detail && detail.entries.length > 0 ? (
                      <div className="ai-run-card__entries">
                        <h4>Entries Created</h4>
                        <div className="ai-run-card__entries-list">
                          {detail.entries.map((entry) => (
                            <div className="ai-run-card__entry" key={entry._id}>
                              <span className={`schedule-status-pill schedule-status-pill--${entry.status}`}>
                                {entry.status}
                              </span>
                              <span className="ai-run-card__entry-zone">{getZoneName(entry.zoneId)}</span>
                              <span className="ai-run-card__entry-time">{formatDate(entry.plannedStartAt)}</span>
                              <span className="muted">{entry.plannedDurationMinutes} min</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : detail ? (
                      <p className="muted">No entries created — conditions not favorable.</p>
                    ) : null}

                    {run.promptTokens != null && (
                      <p className="ai-run-card__tokens muted">
                        {run.promptTokens.toLocaleString()} prompt + {(run.completionTokens ?? 0).toLocaleString()} completion tokens
                      </p>
                    )}

                    {detail?.run && (
                      <button
                        type="button"
                        className="ghost-button schedule-run__view-interaction"
                        onClick={() => handleViewInteraction(run.scheduleRunId)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                        View Interaction
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Shared pagination control. hasPreviousPage/hasNextPage reproduce the
          original `page <= 1` / `page >= totalPages` disabled logic exactly. */}
      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          hasPreviousPage={page > 1}
          hasNextPage={page < totalPages}
          onPrev={() => setPage((p) => p - 1)}
          onNext={() => setPage((p) => p + 1)}
        />
      )}

      {interactionRun && (
        <AIInteractionModal run={interactionRun} onClose={() => setInteractionRun(null)} />
      )}

      {confirmDelete && createPortal(
        <div className="modal-overlay confirm-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-dialog">
            <div className="confirm-dialog__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
            </div>
            <h3 className="confirm-dialog__title">Delete AI runs</h3>
            <p className="confirm-dialog__message">
              {hasActiveFilters
                ? <>This will permanently delete all <strong>{totalCount}</strong> AI runs matching your current filters.</>
                : <>This will permanently delete <strong>all {totalCount}</strong> AI runs.</>
              } This action cannot be undone.
            </p>
            <div className="confirm-dialog__actions">
              <button type="button" className="ghost-button" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={() => void handleDelete()} disabled={deleting}>
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

export default AIRunsPage;
