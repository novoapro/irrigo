import { type Dispatch, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import type { ScheduleEntry, ScheduleRun, Zone } from "../../types";

interface AIRunSummaryProps {
  lastAIRun: ScheduleRun | null;
  lastAIRunEntries: ScheduleEntry[];
  aiScheduleEnabled: boolean;
  dashboardRunningAI: boolean;
  aiRunExpanded: boolean;
  setAiRunExpanded: Dispatch<SetStateAction<boolean>>;
  onRunDashboardAI: () => void;
  zones: Zone[];
}

/** The dashboard's "Last AI Run" summary card. Extracted from DashboardView. */
const AIRunSummary = ({
  lastAIRun,
  lastAIRunEntries,
  aiScheduleEnabled,
  dashboardRunningAI,
  aiRunExpanded,
  setAiRunExpanded,
  onRunDashboardAI,
  zones
}: AIRunSummaryProps) => (
  <section className="ai-run-summary">
    <div className="ai-run-summary__top-row">
      {lastAIRun && (
        <button
          type="button"
          className="ai-run-summary__header"
          onClick={() => setAiRunExpanded((v) => !v)}
        >
          <h3>Last AI Run</h3>
          <span className={`schedule-status-pill schedule-status-pill--${lastAIRun.status}`}>
            {lastAIRun.status}
          </span>
          <span className="ai-run-summary__time">
            {new Date(lastAIRun.startedAt).toLocaleString("en-US", {
              month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true
            })}
          </span>
          <span className="muted" style={{ fontSize: "var(--text-xs)" }}>
            {lastAIRun.triggeredBy === "cron" ? "auto" : "manual"}
            {typeof lastAIRun.entries === "number" && lastAIRun.entries > 0
              ? ` · ${lastAIRun.entries} zone${lastAIRun.entries !== 1 ? "s" : ""}`
              : ""}
          </span>
        </button>
      )}
      {!lastAIRun && <h3 style={{ margin: 0 }}>AI Runs</h3>}
      {aiScheduleEnabled && (
        <button
          type="button"
          className={`icon-btn ai-run-status-btn ai-run-status-btn--${dashboardRunningAI ? "running" : lastAIRun?.status === "completed" ? "success" : lastAIRun?.status ?? "none"}`}
          disabled={dashboardRunningAI}
          onClick={onRunDashboardAI}
          title={dashboardRunningAI ? "Running..." : "Run AI Run"}
          aria-label={dashboardRunningAI ? "Running..." : "Run AI Run"}
        >
          {dashboardRunningAI ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
          )}
        </button>
      )}
    </div>
    {lastAIRun && aiRunExpanded && (
      <div className="ai-run-summary__body">
        {lastAIRun.reasoning && (
          <p className="ai-run-summary__reasoning">{lastAIRun.reasoning}</p>
        )}
        {lastAIRun.errorMessage && (
          <p className="ai-run-summary__error">{lastAIRun.errorMessage}</p>
        )}
        {lastAIRunEntries.length > 0 && (
          <div className="ai-run-summary__entries">
            {lastAIRunEntries.map((entry) => {
              const zone = zones.find((z) => z.zoneId === entry.zoneId);
              return (
                <div className="ai-run-summary__entry" key={entry._id}>
                  <span className="ai-run-summary__zone-name">{zone?.name ?? entry.zoneId}</span>
                  <span className="ai-run-summary__zone-dur">{entry.plannedDurationMinutes} min</span>
                  <span className="ai-run-summary__zone-time">
                    {new Date(entry.plannedStartAt).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <Link to="/ai-runs" className="ai-run-summary__cta">
          View all AI Runs
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </Link>
      </div>
    )}
  </section>
);

export default AIRunSummary;
