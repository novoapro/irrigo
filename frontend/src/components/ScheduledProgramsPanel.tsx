import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import type { IrrigationProgram, Zone } from "../types";
import { fetchPrograms, deleteProgram, runProgram, updateProgram } from "../api";
import ProgramFormModal from "./ProgramFormModal";

interface ScheduledProgramsPanelProps {
  zones: Zone[];
  onScheduleChanged: () => void;
  onOpenSettings?: () => void;
  guardActive?: boolean;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatCronTime = (h: number, m: number): string => {
  const period = h < 12 ? "AM" : "PM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${m.toString().padStart(2, "0")} ${period}`;
};

const formatSchedule = (cron: string): string => {
  const parts = cron.trim().split(/\s+/);
  const minute = parseInt(parts[0] ?? "0", 10);
  const hour = parseInt(parts[1] ?? "0", 10);
  const timeStr = formatCronTime(hour, minute);
  const dayOfMonth = parts[2] ?? "*";
  const dayOfWeek = parts[4] ?? "*";

  if (dayOfWeek !== "*") {
    const days = dayOfWeek.split(",").map(Number).filter((n) => !isNaN(n));
    if (days.length === 1) return `Weekly on ${DAY_NAMES[days[0]!] ?? "Mon"} at ${timeStr}`;
    const dayLabels = days.map((d) => DAY_NAMES[d] ?? String(d)).join(", ");
    return `${dayLabels} at ${timeStr}`;
  }
  if (dayOfMonth === "*/3") return `Every 3 days at ${timeStr}`;
  if (dayOfMonth === "*/2") return `Every 2 days at ${timeStr}`;
  return `Daily at ${timeStr}`;
};

const ScheduledProgramsPanel = ({ zones, onScheduleChanged, onOpenSettings, guardActive }: ScheduledProgramsPanelProps) => {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<IrrigationProgram | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [guardConfirmProgramId, setGuardConfirmProgramId] = useState<string | null>(null);

  const { data: programs = [], isLoading: loading, refetch } = useQuery({
    queryKey: ["scheduledPrograms"],
    queryFn: async () => (await fetchPrograms({ source: "manual" })) ?? []
  });
  const loadPrograms = useCallback(() => {
    void refetch();
  }, [refetch]);

  const executeRun = useCallback(async (programId: string) => {
    setRunningId(programId);
    try {
      await runProgram(programId);
      onScheduleChanged();
    } catch (err) {
      console.error("Failed to run program:", err);
    } finally {
      setRunningId(null);
    }
  }, [onScheduleChanged]);

  const handleRun = useCallback((programId: string) => {
    if (guardActive) {
      setGuardConfirmProgramId(programId);
    } else {
      void executeRun(programId);
    }
  }, [guardActive, executeRun]);

  const handleToggle = useCallback(async (program: IrrigationProgram) => {
    try {
      await updateProgram(program.programId, { enabled: !program.enabled });
      void loadPrograms();
    } catch (err) {
      console.error("Failed to toggle program:", err);
    }
  }, [loadPrograms]);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await deleteProgram(confirmDeleteId);
      setConfirmDeleteId(null);
      void loadPrograms();
    } catch (err) {
      console.error("Failed to delete program:", err);
    } finally {
      setDeleting(false);
    }
  }, [confirmDeleteId, loadPrograms]);

  const handleEdit = (program: IrrigationProgram) => {
    setEditingProgram(program);
    setFormOpen(true);
  };

  const handleAdd = () => {
    setEditingProgram(null);
    setFormOpen(true);
  };

  const handleFormSaved = () => {
    void loadPrograms();
    onScheduleChanged();
  };

  const getZoneNames = (entries: IrrigationProgram["zoneEntries"]) => {
    return entries.map((e) => {
      const zone = zones.find((z) => z.zoneId === e.zoneId);
      return zone?.name ?? e.zoneId;
    });
  };

  return (
    <section className="scheduled-programs-panel">
      <header className="scheduled-programs-panel__header">
        <h3>Scheduled Programs</h3>
        <div className="scheduled-programs-panel__actions">
          {onOpenSettings && (
            <button
              type="button"
              className="ghost-button icon-btn"
              onClick={onOpenSettings}
              title="Settings"
              aria-label="Program settings"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
          )}
          <button
            type="button"
            className="primary-button icon-btn"
            onClick={handleAdd}
            title="Add program"
            aria-label="Add program"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        </div>
      </header>

      {loading ? (
        <p className="muted">Loading programs...</p>
      ) : programs.length === 0 ? (
        <div className="scheduled-programs-empty">
          <p className="muted">No programs yet. Create one to set up automated irrigation schedules.</p>
        </div>
      ) : (
        <div className="program-cards">
          {programs.map((program) => (
            <div className={`program-card${program.enabled ? "" : " program-card--disabled"}`} key={program.programId}>
              <div className="program-card__header">
                <h4 className="program-card__name">{program.name}</h4>
                <label
                  className={`toggle-switch toggle-switch--sm${program.enabled ? " toggle-switch--on" : ""}`}
                  role="switch"
                  aria-checked={program.enabled}
                  aria-label={`${program.enabled ? "Disable" : "Enable"} ${program.name}`}
                >
                  <input
                    type="checkbox"
                    checked={program.enabled}
                    onChange={() => void handleToggle(program)}
                  />
                  <span className="toggle-switch__track">
                    <span className="toggle-switch__thumb" />
                  </span>
                </label>
              </div>

              <p className="program-card__schedule muted">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                {program.scheduleCron ? formatSchedule(program.scheduleCron) : "One-time"}
              </p>

              <div className="program-card__zones">
                {getZoneNames(program.zoneEntries).map((name, i) => (
                  <span className="program-card__zone-tag" key={i}>
                    {name}
                    <span className="program-card__zone-duration">
                      {program.zoneEntries[i]!.durationMinutes}m
                    </span>
                  </span>
                ))}
              </div>

              <div className="program-card__actions">
                <button
                  type="button"
                  className="ghost-button icon-btn"
                  onClick={() => handleEdit(program)}
                  title="Edit"
                  aria-label={`Edit ${program.name}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                </button>
                <button
                  type="button"
                  className="ghost-button icon-btn"
                  onClick={() => void handleRun(program.programId)}
                  disabled={runningId === program.programId}
                  title="Run now"
                  aria-label={`Run ${program.name} now`}
                >
                  {runningId === program.programId ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
                  )}
                </button>
                <button
                  type="button"
                  className="ghost-button icon-btn danger-text"
                  onClick={() => setConfirmDeleteId(program.programId)}
                  title="Delete"
                  aria-label={`Delete ${program.name}`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ProgramFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={handleFormSaved}
        zones={zones}
        program={editingProgram}
      />

      {confirmDeleteId && createPortal(
        <div className="modal-overlay confirm-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-dialog">
            <div className="confirm-dialog__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
            </div>
            <h3 className="confirm-dialog__title">Delete program</h3>
            <p className="confirm-dialog__message">
              Are you sure you want to delete <strong>{programs.find((p) => p.programId === confirmDeleteId)?.name ?? "this program"}</strong>? This action cannot be undone.
            </p>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setConfirmDeleteId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => void handleConfirmDelete()}
                disabled={deleting}
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {guardConfirmProgramId && createPortal(
        <div className="modal-overlay confirm-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-dialog">
            <div className="confirm-dialog__icon" style={{ background: "var(--color-warning-bg)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            </div>
            <h3 className="confirm-dialog__title">Guard is active</h3>
            <p className="confirm-dialog__message">
              The irrigation guard is on — conditions are not ideal for irrigation. Do you still want to run <strong>{programs.find((p) => p.programId === guardConfirmProgramId)?.name ?? "this program"}</strong>?
            </p>
            <div className="confirm-dialog__actions">
              <button type="button" className="ghost-button" onClick={() => setGuardConfirmProgramId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => { void executeRun(guardConfirmProgramId); setGuardConfirmProgramId(null); }}
              >
                Proceed anyway
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
};

export default ScheduledProgramsPanel;
