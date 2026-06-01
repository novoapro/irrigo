import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { deleteControllerLogs, deleteWebhookEvents, fetchControllerLogs, fetchWebhookEvents, fetchZones, type ControllerLogQuery, type WebhookEventQuery } from "../api";
import type { IrrigationCommand, WebhookEvent, Zone } from "../types";
import Dropdown from "../components/Dropdown";
import DateTimeInput from "../components/DateTimeInput";
import { formatTimestamp, toQueryDateTime } from "../utils/date";

const PAGE_SIZE = 25;

const SOURCE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "manual", label: "Manual" },
  { value: "program", label: "Program" },
  { value: "ai-schedule", label: "AI Schedule" },
  { value: "schedule", label: "Schedule" }
];

const ACTION_OPTIONS = [
  { value: "all", label: "All" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" }
];

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "sent", label: "Sent" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "failed", label: "Failed" },
  { value: "timeout", label: "Timeout" }
];

const sourceLabel = (source: string) => {
  if (source === "ai-schedule") return "AI Schedule";
  return source.charAt(0).toUpperCase() + source.slice(1);
};

const formatDuration = (minutes: number | null | undefined) =>
  minutes != null ? `${minutes} min` : "—";

type LogTab = "commands" | "events";

const CHARACTERISTIC_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inUse", label: "In Use" },
  { value: "remainingDuration", label: "Remaining Duration" },
  { value: "setDuration", label: "Set Duration" },
  { value: "isConfigured", label: "Is Configured" }
];

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const LogsPage = () => {
  const [activeTab, setActiveTab] = useState<LogTab>("commands");

  const [logs, setLogs] = useState<IrrigationCommand[]>([]);
  const [meta, setMeta] = useState<{ page: number; pageSize: number; totalCount: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean } | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [zoneFilter, setZoneFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);
  const [webhookMeta, setWebhookMeta] = useState<{ page: number; pageSize: number; totalCount: number; totalPages: number; hasNextPage: boolean; hasPreviousPage: boolean } | null>(null);
  const [webhookPage, setWebhookPage] = useState(1);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookStartDate, setWebhookStartDate] = useState<Date | null>(null);
  const [webhookEndDate, setWebhookEndDate] = useState<Date | null>(null);
  const [webhookZoneFilter, setWebhookZoneFilter] = useState("all");
  const [webhookTypeFilter, setWebhookTypeFilter] = useState("all");

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    fetchZones().then(setZones).catch(() => {});
    return () => { mountedRef.current = false; };
  }, []);

  const loadLogs = useCallback(
    async (p: number, start: Date | null, end: Date | null, zone: string, source: string, action: string, status: string) => {
      setLoading(true);
      setError(null);
      try {
        const query: ControllerLogQuery = {
          page: p,
          pageSize: PAGE_SIZE,
          start: start ? toQueryDateTime(start) : undefined,
          end: end ? toQueryDateTime(end) : undefined
        };
        if (zone !== "all") query.zoneId = zone;
        if (source !== "all") query.source = source;
        if (action !== "all") query.action = action;
        if (status !== "all") query.status = status;

        const result = await fetchControllerLogs(query);
        if (!mountedRef.current) return;
        setLogs(result.commands);
        setMeta(result.meta);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load logs");
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (activeTab === "commands") {
      loadLogs(page, startDate, endDate, zoneFilter, sourceFilter, actionFilter, statusFilter);
    }
  }, [page, startDate, endDate, zoneFilter, sourceFilter, actionFilter, statusFilter, loadLogs, activeTab]);

  const loadWebhookEvents = useCallback(
    async (p: number, start: Date | null, end: Date | null, zone: string, charType: string) => {
      setWebhookLoading(true);
      setError(null);
      try {
        const query: WebhookEventQuery = {
          page: p,
          pageSize: PAGE_SIZE,
          start: start ? toQueryDateTime(start) : undefined,
          end: end ? toQueryDateTime(end) : undefined
        };
        if (zone !== "all") query.zoneId = zone;
        if (charType !== "all") query.characteristicType = charType;

        const result = await fetchWebhookEvents(query);
        if (!mountedRef.current) return;
        setWebhookEvents(result.events);
        setWebhookMeta(result.meta);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load events");
      } finally {
        if (mountedRef.current) setWebhookLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (activeTab === "events") {
      loadWebhookEvents(webhookPage, webhookStartDate, webhookEndDate, webhookZoneFilter, webhookTypeFilter);
    }
  }, [webhookPage, webhookStartDate, webhookEndDate, webhookZoneFilter, webhookTypeFilter, loadWebhookEvents, activeTab]);

  const totalPages = meta?.totalPages ?? 1;
  const totalCount = meta?.totalCount ?? logs.length;

  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const hasActiveFilters =
    startDate !== null ||
    endDate !== null ||
    zoneFilter !== "all" ||
    sourceFilter !== "all" ||
    actionFilter !== "all" ||
    statusFilter !== "all";

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const query: Omit<ControllerLogQuery, "page" | "pageSize"> = {};
      if (startDate) query.start = toQueryDateTime(startDate);
      if (endDate) query.end = toQueryDateTime(endDate);
      if (zoneFilter !== "all") query.zoneId = zoneFilter;
      if (sourceFilter !== "all") query.source = sourceFilter;
      if (actionFilter !== "all") query.action = actionFilter;
      if (statusFilter !== "all") query.status = statusFilter;
      await deleteControllerLogs(query);
      setConfirmDelete(false);
      setPage(1);
      loadLogs(1, startDate, endDate, zoneFilter, sourceFilter, actionFilter, statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete logs");
    } finally {
      setDeleting(false);
    }
  }, [startDate, endDate, zoneFilter, sourceFilter, actionFilter, statusFilter, loadLogs]);

  const hasWebhookFilters =
    webhookStartDate !== null ||
    webhookEndDate !== null ||
    webhookZoneFilter !== "all" ||
    webhookTypeFilter !== "all";

  const handleDeleteWebhookEvents = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const query: Omit<WebhookEventQuery, "page" | "pageSize"> = {};
      if (webhookStartDate) query.start = toQueryDateTime(webhookStartDate);
      if (webhookEndDate) query.end = toQueryDateTime(webhookEndDate);
      if (webhookZoneFilter !== "all") query.zoneId = webhookZoneFilter;
      if (webhookTypeFilter !== "all") query.characteristicType = webhookTypeFilter;
      await deleteWebhookEvents(query);
      setConfirmDelete(false);
      setWebhookPage(1);
      loadWebhookEvents(1, webhookStartDate, webhookEndDate, webhookZoneFilter, webhookTypeFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete events");
    } finally {
      setDeleting(false);
    }
  }, [webhookStartDate, webhookEndDate, webhookZoneFilter, webhookTypeFilter, loadWebhookEvents]);

  const handleReset = () => {
    if (activeTab === "commands") {
      setStartDate(null);
      setEndDate(null);
      setZoneFilter("all");
      setSourceFilter("all");
      setActionFilter("all");
      setStatusFilter("all");
      setPage(1);
    } else {
      setWebhookStartDate(null);
      setWebhookEndDate(null);
      setWebhookZoneFilter("all");
      setWebhookTypeFilter("all");
      setWebhookPage(1);
    }
  };

  const zoneOptions = [
    { value: "all", label: "All zones" },
    ...zones.map((z) => ({ value: z.zoneId, label: z.name }))
  ];

  const zoneName = (zoneId: string) => {
    const z = zones.find((zone) => zone.zoneId === zoneId);
    return z?.name ?? zoneId;
  };

  const webhookTotalPages = webhookMeta?.totalPages ?? 1;
  const webhookTotalCount = webhookMeta?.totalCount ?? webhookEvents.length;

  return (
    <div className="records-page">
      <header className="records-page__header">
        <div>
          <h2>Controller Logs</h2>
          <p className="muted">
            {activeTab === "commands"
              ? `${totalCount} command${totalCount === 1 ? "" : "s"} found`
              : `${webhookTotalCount} event${webhookTotalCount === 1 ? "" : "s"} received`
            }
          </p>
        </div>
        {((activeTab === "commands" && totalCount > 0) || (activeTab === "events" && webhookTotalCount > 0)) && (
          <button
            type="button"
            className="records-delete-btn"
            onClick={() => setConfirmDelete(true)}
            title={activeTab === "commands"
              ? (hasActiveFilters ? "Delete filtered logs" : "Delete all logs")
              : (hasWebhookFilters ? "Delete filtered events" : "Delete all events")
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
              <path d="M10 11v6M14 11v6M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
            </svg>
          </button>
        )}
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="logs-tabs">
        <button
          type="button"
          className={`logs-tab${activeTab === "commands" ? " logs-tab--active" : ""}`}
          onClick={() => setActiveTab("commands")}
        >
          Commands Sent
        </button>
        <button
          type="button"
          className={`logs-tab${activeTab === "events" ? " logs-tab--active" : ""}`}
          onClick={() => setActiveTab("events")}
        >
          Incoming Events
        </button>
      </div>

      {activeTab === "commands" && (<><div className="records-filters records-filters--no-border">
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
          <div className="records-filter-group">
            <label>Action</label>
            <Dropdown
              value={actionFilter}
              options={ACTION_OPTIONS}
              onChange={(v) => { setActionFilter(v); setPage(1); }}
            />
          </div>
          <div className="records-filter-group">
            <label>Status</label>
            <Dropdown
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={(v) => { setStatusFilter(v); setPage(1); }}
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
          <h3>Logs</h3>
          <span className="history-header-subtitle muted">
            Showing {logs.length} of {totalCount} log
            {totalCount === 1 ? "" : "s"} &bull; Page {page} of {totalPages}
          </span>
        </header>

        {totalCount === 0 ? (
          <p className="muted">No controller logs available for this range.</p>
        ) : (
          <div className={`history-content${loading ? " history-content--loading" : ""}`}>
            <div className="table-wrapper history-table-wrapper">
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Zone</th>
                    <th>Action</th>
                    <th>Duration</th>
                    <th>Source</th>
                    <th>Status</th>
                    <th>Controller</th>
                    <th>Response</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log._id}>
                      <td>{formatTimestamp(log.createdAt)}</td>
                      <td>{zoneName(log.zoneId)}</td>
                      <td>
                        <span className={`command-action command-action--${log.action}`}>
                          {log.action.toUpperCase()}
                        </span>
                      </td>
                      <td>{formatDuration(log.durationMinutes)}</td>
                      <td>
                        <span className={`source-chip source-chip--${log.source}`}>
                          {sourceLabel(log.source)}
                        </span>
                      </td>
                      <td>
                        <span className={`command-status command-status--${log.status}`}>
                          {log.status}
                        </span>
                      </td>
                      <td>{log.controllerMethod ?? "—"}</td>
                      <td>{log.controllerResponseStatus ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="history-cards">
              {logs.map((log) => (
                <article key={`card-${log._id}`} className="history-card">
                  <header className="history-card-header">
                    <div>
                      <span className="history-card-label">Timestamp</span>
                      <span className="history-card-timestamp">{formatTimestamp(log.createdAt)}</span>
                    </div>
                    <span className={`command-status command-status--${log.status}`}>
                      {log.status}
                    </span>
                  </header>
                  <dl className="history-card-metrics">
                    <div>
                      <dt>Zone</dt>
                      <dd>{zoneName(log.zoneId)}</dd>
                    </div>
                    <div>
                      <dt>Action</dt>
                      <dd>
                        <span className={`command-action command-action--${log.action}`}>
                          {log.action.toUpperCase()}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{formatDuration(log.durationMinutes)}</dd>
                    </div>
                    <div>
                      <dt>Source</dt>
                      <dd>
                        <span className={`source-chip source-chip--${log.source}`}>
                          {sourceLabel(log.source)}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt>Controller</dt>
                      <dd>{log.controllerMethod ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Response</dt>
                      <dd>{log.controllerResponseStatus ?? "—"}</dd>
                    </div>
                    {log.errorMessage && (
                      <div>
                        <dt>Error</dt>
                        <dd className="text-danger">{log.errorMessage}</dd>
                      </div>
                    )}
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
      </section></>)}

      {activeTab === "events" && (
        <>
          <div className="records-filters records-filters--no-border">
            <div className="records-filters__row">
              <div className="records-filter-group">
                <label>From</label>
                <DateTimeInput
                  value={webhookStartDate}
                  onChange={(d) => { setWebhookStartDate(d); setWebhookPage(1); }}
                  max={webhookEndDate ?? new Date()}
                  placeholder="Any"
                  clearable
                />
              </div>
              <div className="records-filter-group">
                <label>To</label>
                <DateTimeInput
                  value={webhookEndDate}
                  onChange={(d) => { setWebhookEndDate(d); setWebhookPage(1); }}
                  min={webhookStartDate ?? undefined}
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
                  value={webhookZoneFilter}
                  options={zoneOptions}
                  onChange={(v) => { setWebhookZoneFilter(v); setWebhookPage(1); }}
                />
              </div>
              <div className="records-filter-group">
                <label>Type</label>
                <Dropdown
                  value={webhookTypeFilter}
                  options={CHARACTERISTIC_OPTIONS}
                  onChange={(v) => { setWebhookTypeFilter(v); setWebhookPage(1); }}
                />
              </div>
            </div>

            {hasWebhookFilters && (
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
              <h3>Incoming Events</h3>
              <span className="history-header-subtitle muted">
                Showing {webhookEvents.length} of {webhookTotalCount} event
                {webhookTotalCount === 1 ? "" : "s"} &bull; Page {webhookPage} of {webhookTotalPages}
              </span>
            </header>

            {webhookTotalCount === 0 ? (
              <p className="muted">No incoming events recorded yet.</p>
            ) : (
              <div className={`history-content${webhookLoading ? " history-content--loading" : ""}`}>
                <div className="table-wrapper history-table-wrapper">
                  <table className="history-table">
                    <thead>
                      <tr>
                        <th>Received</th>
                        <th>Zone</th>
                        <th>Characteristic</th>
                        <th>Old Value</th>
                        <th>New Value</th>
                        <th>Processed</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {webhookEvents.map((evt) => (
                        <tr key={evt._id}>
                          <td>{formatTimestamp(evt.receivedAt)}</td>
                          <td>{evt.zoneName ?? evt.zoneId ?? "—"}</td>
                          <td>
                            <span className="characteristic-chip">
                              {evt.characteristicName ?? evt.characteristicType}
                            </span>
                          </td>
                          <td>{formatValue(evt.oldValue)}</td>
                          <td>{formatValue(evt.newValue)}</td>
                          <td>
                            <span className={`command-status command-status--${evt.processed ? "acknowledged" : "failed"}`}>
                              {evt.processed ? "yes" : "no"}
                            </span>
                          </td>
                          <td>{evt.result ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="history-cards">
                  {webhookEvents.map((evt) => (
                    <article key={`card-${evt._id}`} className="history-card">
                      <header className="history-card-header">
                        <div>
                          <span className="history-card-label">Received</span>
                          <span className="history-card-timestamp">{formatTimestamp(evt.receivedAt)}</span>
                        </div>
                        <span className={`command-status command-status--${evt.processed ? "acknowledged" : "failed"}`}>
                          {evt.processed ? "processed" : "skipped"}
                        </span>
                      </header>
                      <dl className="history-card-metrics">
                        <div>
                          <dt>Zone</dt>
                          <dd>{evt.zoneName ?? evt.zoneId ?? "—"}</dd>
                        </div>
                        <div>
                          <dt>Characteristic</dt>
                          <dd>{evt.characteristicName ?? evt.characteristicType}</dd>
                        </div>
                        <div>
                          <dt>Old Value</dt>
                          <dd>{formatValue(evt.oldValue)}</dd>
                        </div>
                        <div>
                          <dt>New Value</dt>
                          <dd>{formatValue(evt.newValue)}</dd>
                        </div>
                        <div>
                          <dt>Result</dt>
                          <dd>{evt.result ?? "—"}</dd>
                        </div>
                      </dl>
                    </article>
                  ))}
                </div>

                <div className="pagination-controls">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setWebhookPage((p) => Math.max(1, p - 1))}
                    disabled={!(webhookMeta?.hasPreviousPage ?? webhookPage > 1)}
                  >
                    &lt;
                  </button>
                  <span className="muted pagination-status">
                    Page {webhookPage} of {webhookTotalPages}
                  </span>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setWebhookPage((p) => p + 1)}
                    disabled={!(webhookMeta?.hasNextPage ?? webhookPage < webhookTotalPages)}
                  >
                    &gt;
                  </button>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      {confirmDelete && createPortal(
        <div className="modal-overlay confirm-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-dialog">
            <div className="confirm-dialog__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
            </div>
            <h3 className="confirm-dialog__title">
              {activeTab === "commands" ? "Delete controller logs" : "Delete webhook events"}
            </h3>
            <p className="confirm-dialog__message">
              {activeTab === "commands"
                ? (hasActiveFilters
                    ? <>This will permanently delete all <strong>{totalCount}</strong> controller logs matching your current filters.</>
                    : <>This will permanently delete <strong>all {totalCount}</strong> controller logs.</>)
                : (hasWebhookFilters
                    ? <>This will permanently delete all <strong>{webhookTotalCount}</strong> webhook events matching your current filters.</>
                    : <>This will permanently delete <strong>all {webhookTotalCount}</strong> webhook events.</>)
              } This action cannot be undone.
            </p>
            <div className="confirm-dialog__actions">
              <button type="button" className="ghost-button" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="danger-button" onClick={activeTab === "commands" ? handleDelete : handleDeleteWebhookEvents} disabled={deleting}>
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

export default LogsPage;
