import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { AIScheduleConfig, IrrigationMode, IrrigationProgram, ScheduleEntry, Zone } from "../types";
import {
  fetchAIScheduleConfig,
  fetchMaterializedProgramEntries,
  skipScheduleEntry,
  deferScheduleEntry,
  materializeProgramEntries,
  rescheduleProgramEntries,
  fetchPrograms,
  updateSystemConfig,
  cancelAIProgram,
  deferAIProgram
} from "../api";
import DateTimeInput from "./DateTimeInput";

interface IrrigationQueuePanelProps {
  zones: Zone[];
  irrigationMode: IrrigationMode;
  aiScheduleEnabled: boolean;
  refreshKey?: number;
  onModeChanged: (mode: IrrigationMode) => void;
  onScheduleChanged: () => void;
  onOpenSmartSettings: () => void;
  onOpenProgramSettings: () => void;
}

// ── Shared types ──

interface QueueZoneStep {
  zoneId: string;
  zoneName: string;
  durationMinutes: number;
}

interface QueueSequence {
  id: string;
  scheduledAt: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed" | "deferred";
  source: "program" | "ai-schedule";
  sourceLabel: string;
  zones: QueueZoneStep[];
  totalMinutes: number;
  aiReasoning?: string;
  entryIds?: string[];
  programId?: string;
  userModified?: boolean;
}

// ── Helpers ──

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

const parseDowField = (field: string): Set<number> | null => {
  if (field === "*") return null;
  const values = new Set<number>();
  for (const segment of field.split(",")) {
    const rangeParts = segment.split("-");
    if (rangeParts.length === 2) {
      const start = parseInt(rangeParts[0]!, 10);
      const end = parseInt(rangeParts[1]!, 10);
      for (let i = start; i <= end; i++) values.add(i);
    } else {
      const v = parseInt(segment, 10);
      if (!isNaN(v)) values.add(v);
    }
  }
  return values.size > 0 ? values : null;
};

const nextCronRun = (cron: string, after?: Date): Date | null => {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const minute = parseInt(parts[0]!, 10);
  const hour = parseInt(parts[1]!, 10);
  if (isNaN(minute) || isNaN(hour)) return null;

  const domPart = parts[2] ?? "*";
  const dowPart = parts[4] ?? "*";
  const allowedDays = parseDowField(dowPart);
  const domStep = domPart.match(/^\*\/(\d+)$/);
  const domInterval = domStep ? parseInt(domStep[1]!, 10) : 0;

  const ref = after ?? new Date();
  const candidate = new Date(ref);
  candidate.setHours(hour, minute, 0, 0);
  if (candidate <= ref) candidate.setDate(candidate.getDate() + 1);

  for (let i = 0; i < 60; i++) {
    const dayOk = !allowedDays || allowedDays.has(candidate.getDay());
    const domOk = !domInterval || candidate.getDate() % domInterval === 1;
    if (dayOk && domOk) return candidate;
    candidate.setDate(candidate.getDate() + 1);
  }
  return null;
};

// ── Build unified queue sequences ──

const buildProgramSequences = (
  programs: IrrigationProgram[],
  getZoneName: (id: string) => string
): QueueSequence[] =>
  programs
    .filter((p) => p.enabled && p.scheduleCron)
    .map((program) => {
      const baseTime = nextCronRun(program.scheduleCron!);
      return {
        id: program.programId,
        scheduledAt: baseTime?.toISOString() ?? new Date().toISOString(),
        status: "pending" as const,
        source: "program" as const,
        sourceLabel: program.name,
        programId: program.programId,
        zones: program.zoneEntries.map((ze) => ({
          zoneId: ze.zoneId,
          zoneName: getZoneName(ze.zoneId),
          durationMinutes: ze.durationMinutes,
        })),
        totalMinutes: program.zoneEntries.reduce((s, e) => s + e.durationMinutes, 0),
      };
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

const mapProgramStatus = (status?: string): QueueSequence["status"] => {
  switch (status) {
    case "planned": return "pending";
    case "executing": return "running";
    case "completed": return "completed";
    case "cancelled": return "skipped";
    case "skipped": return "skipped";
    case "deferred": return "deferred";
    default: return "pending";
  }
};

const buildSmartSequences = (
  aiPrograms: IrrigationProgram[],
  getZoneName: (id: string) => string
): QueueSequence[] =>
  aiPrograms
    .filter((p) => p.source === "ai-schedule" && p.status !== "cancelled")
    .map((program) => ({
      id: program.programId,
      scheduledAt: program.plannedStartAt ?? program.createdAt ?? new Date().toISOString(),
      status: mapProgramStatus(program.status),
      source: "ai-schedule" as const,
      sourceLabel: program.name,
      programId: program.programId,
      zones: program.zoneEntries.map((ze) => ({
        zoneId: ze.zoneId,
        zoneName: getZoneName(ze.zoneId),
        durationMinutes: ze.durationMinutes,
      })),
      totalMinutes: program.zoneEntries.reduce((s, e) => s + e.durationMinutes, 0),
      aiReasoning: program.aiReasoning,
    }))
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

const buildScheduledEntrySequences = (
  entries: ScheduleEntry[],
  getZoneName: (id: string) => string
): QueueSequence[] => {
  const byRun = new Map<string, ScheduleEntry[]>();
  for (const e of entries) {
    const key = e.scheduleRunId;
    if (!byRun.has(key)) byRun.set(key, []);
    byRun.get(key)!.push(e);
  }

  return Array.from(byRun.entries()).map(([runId, runEntries]) => {
    const sorted = [...runEntries].sort(
      (a, b) => new Date(a.plannedStartAt).getTime() - new Date(b.plannedStartAt).getTime()
    );
    const first = sorted[0]!;
    const allCompleted = sorted.every((e) => e.status === "completed");
    const anyExecuting = sorted.some((e) => e.status === "executing" || e.status === "queued");
    const anyFailed = sorted.some((e) => e.status === "skipped" && e.skipReason?.toLowerCase().includes("error"));
    const allSkipped = sorted.every((e) => e.status === "skipped" || e.status === "cancelled");
    const anyDeferred = sorted.some((e) => e.status === "deferred");

    let status: QueueSequence["status"] = "pending";
    if (allCompleted) status = "completed";
    else if (anyFailed) status = "failed";
    else if (allSkipped) status = "skipped";
    else if (anyDeferred) status = "deferred";
    else if (anyExecuting) status = "running";

    const reasoning = sorted
      .map((e) => e.aiReasoning)
      .filter(Boolean)
      .join(" ");

    return {
      id: runId,
      scheduledAt: first.plannedStartAt,
      status,
      source: "ai-schedule" as const,
      sourceLabel: "AI Schedule",
      zones: sorted.map((e) => ({
        zoneId: e.zoneId,
        zoneName: getZoneName(e.zoneId),
        durationMinutes: e.plannedDurationMinutes,
      })),
      totalMinutes: sorted.reduce((s, e) => s + e.plannedDurationMinutes, 0),
      aiReasoning: reasoning || undefined,
      entryIds: sorted.map((e) => e._id),
      userModified: sorted.some((e) => e.userModified),
    };
  }).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
};

// ── Queue card (unified for both modes) ──

const QueueSequenceCard = ({
  seq,
  onSkip,
  onDefer,
  onReschedule,
}: {
  seq: QueueSequence;
  onSkip: (seq: QueueSequence) => void;
  onDefer: (seq: QueueSequence, newDate: Date) => void;
  onReschedule?: (seq: QueueSequence) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [deferring, setDeferring] = useState(false);
  const [deferValue, setDeferValue] = useState<Date | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const isPending = seq.status === "pending";
  const isDeferred = seq.status === "deferred";
  const isSkipped = seq.status === "skipped";

  const openDefer = () => {
    setDeferValue(new Date(seq.scheduledAt));
    setDeferring(true);
  };

  const handleDeferConfirm = () => {
    if (!deferValue) return;
    onDefer(seq, deferValue);
    setDeferring(false);
  };

  return (
    <div className="queue-card">
      <div className="queue-card__top">
        <button
          type="button"
          className="queue-card__summary"
          onClick={() => setExpanded((v) => !v)}
        >
          <span className={`schedule-status-pill schedule-status-pill--${seq.status === "pending" ? "planned" : seq.status}`}>
            {seq.status}
          </span>
          <span className="queue-card__source-label muted">{seq.sourceLabel}</span>
          {seq.userModified && (
            <span className="schedule-status-pill schedule-status-pill--modified" title="Modified by user">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
            </span>
          )}
          <span className="queue-card__time">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            {formatDate(seq.scheduledAt)}
          </span>
          <span className="queue-card__total muted">
            {seq.zones.length} zone{seq.zones.length !== 1 ? "s" : ""} · {seq.totalMinutes} min
          </span>
        </button>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className={`queue-card__expand-icon${expanded ? " queue-card__chevron--open" : ""}`} onClick={() => setExpanded((v) => !v)}>
          <path d="M6.293 7.293a1 1 0 011.414 0L10 9.586l2.293-2.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" />
        </svg>
        {isSkipped && onReschedule && seq.source === "program" && (
          <div className="queue-card__actions">
            <button
              type="button"
              className="ghost-button icon-btn"
              onClick={() => onReschedule(seq)}
              title="Reschedule"
              aria-label="Reschedule program"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
            </button>
          </div>
        )}
        {(isPending || isDeferred) && (
          <div className="queue-card__actions">
            {deferring && (
              <div className="queue-card__defer">
                <DateTimeInput
                  value={deferValue}
                  onChange={setDeferValue}
                  min={new Date()}
                />
              </div>
            )}
            {deferring ? (
              <>
                <button
                  type="button"
                  className="ghost-button icon-btn"
                  onClick={handleDeferConfirm}
                  title="Confirm"
                  aria-label="Confirm defer"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </button>
                <button
                  type="button"
                  className="ghost-button icon-btn"
                  onClick={() => setDeferring(false)}
                  title="Cancel"
                  aria-label="Cancel defer"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="ghost-button icon-btn"
                  onClick={() => setConfirmSkip(true)}
                  title="Skip"
                  aria-label="Skip sequence"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg>
                </button>
                <button
                  type="button"
                  className="ghost-button icon-btn"
                  onClick={openDefer}
                  title="Defer"
                  aria-label="Defer to a different time"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><path d="M14 14l3 3" /><path d="M17 14l-3 3" /></svg>
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="queue-card__body">
          <div className="queue-card__zones">
            {seq.zones.map((z, i) => (
              <div className="queue-card__zone-row" key={`${z.zoneId}-${i}`}>
                <span className="queue-card__zone-name">{z.zoneName}</span>
                <span className="queue-card__zone-dur">{z.durationMinutes} min</span>
              </div>
            ))}
          </div>

          <div className="queue-card__source muted">{seq.sourceLabel}</div>

          {seq.aiReasoning && (
            <button
              type="button"
              className="queue-card__notes-toggle muted"
              onClick={() => setNotesExpanded((v) => !v)}
            >
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className={notesExpanded ? "queue-card__chevron--open" : ""}>
                <path d="M6.293 7.293a1 1 0 011.414 0L10 9.586l2.293-2.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" />
              </svg>
              AI Notes
            </button>
          )}
          {seq.aiReasoning && notesExpanded && (
            <p className="queue-card__notes">{seq.aiReasoning}</p>
          )}
        </div>
      )}

      {confirmSkip && createPortal(
        <div className="modal-overlay confirm-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-dialog">
            <div className="confirm-dialog__icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4" /><line x1="19" y1="5" x2="19" y2="19" /></svg>
            </div>
            <h3 className="confirm-dialog__title">Skip irrigation</h3>
            <p className="confirm-dialog__message">
              Skip this scheduled irrigation? It will not run.
            </p>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setConfirmSkip(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => { setConfirmSkip(false); onSkip(seq); }}
              >
                Skip
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ── Main panel ──

const IrrigationQueuePanel = ({
  zones,
  irrigationMode,
  aiScheduleEnabled,
  refreshKey,
  onModeChanged,
  onScheduleChanged,
  onOpenSmartSettings,
  onOpenProgramSettings
}: IrrigationQueuePanelProps) => {
  const navigate = useNavigate();
  const [config, setConfig] = useState<AIScheduleConfig | null>(null);
  const [aiPrograms, setAiPrograms] = useState<IrrigationProgram[]>([]);
  const [programs, setPrograms] = useState<IrrigationProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modeChanging, setModeChanging] = useState(false);

  const canToggleMode = aiScheduleEnabled;
  const activeMode = !canToggleMode ? "scheduled" : (irrigationMode === "scheduled" ? "scheduled" : "smart");

  const getZoneName = useCallback((zoneId: string) => {
    const zone = zones.find((z) => z.zoneId === zoneId);
    return zone?.name ?? zoneId;
  }, [zones]);

  const loadSmartData = useCallback(async () => {
    try {
      const [cfg, progs] = await Promise.all([
        fetchAIScheduleConfig(),
        fetchPrograms({ source: "ai-schedule", status: ["planned", "executing", "deferred", "skipped"] }),
      ]);
      setConfig(cfg);
      setAiPrograms(progs);
    } catch (err) {
      console.error("Failed to load AI schedule data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const [programEntries, setProgramEntries] = useState<ScheduleEntry[]>([]);

  const loadScheduledData = useCallback(async () => {
    try {
      const [data, matEntries] = await Promise.all([
        fetchPrograms({ source: "manual" }),
        fetchMaterializedProgramEntries(),
      ]);
      setPrograms(data);
      setProgramEntries(matEntries);
    } catch (err) {
      console.error("Failed to load programs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    if (activeMode === "smart") {
      void loadSmartData();
    } else {
      void loadScheduledData();
    }
  }, [activeMode, loadSmartData, loadScheduledData, refreshKey]);

  const handleModeToggle = useCallback(async (mode: "smart" | "scheduled") => {
    if (mode === activeMode) return;
    setModeChanging(true);
    try {
      await updateSystemConfig(mode);
      onModeChanged(mode);
    } catch (err) {
      console.error("Failed to switch mode:", err);
    } finally {
      setModeChanging(false);
    }
  }, [activeMode, onModeChanged]);

  const materializeIfNeeded = useCallback(async (seq: QueueSequence): Promise<string[]> => {
    if (seq.entryIds && seq.entryIds.length > 0) return seq.entryIds;
    if (seq.source === "program" && seq.programId) {
      const result = await materializeProgramEntries(seq.programId, new Date(seq.scheduledAt));
      return result.entryIds;
    }
    return [];
  }, []);

  const handleSkipSequence = useCallback(async (seq: QueueSequence) => {
    try {
      if (activeMode === "smart" && seq.programId) {
        await cancelAIProgram(seq.programId);
        void loadSmartData();
      } else {
        const ids = await materializeIfNeeded(seq);
        await Promise.all(ids.map((id) => skipScheduleEntry(id, "Manually skipped")));
        void loadScheduledData();
      }
    } catch (err) {
      console.error("Failed to skip:", err);
    }
  }, [materializeIfNeeded, activeMode, loadSmartData, loadScheduledData]);

  const handleDeferSequence = useCallback(async (seq: QueueSequence, newDate: Date) => {
    try {
      if (activeMode === "smart" && seq.programId) {
        await deferAIProgram(seq.programId, newDate);
        void loadSmartData();
      } else {
        const ids = await materializeIfNeeded(seq);
        await Promise.all(ids.map((id) => deferScheduleEntry(id, newDate)));
        void loadScheduledData();
      }
    } catch (err) {
      console.error("Failed to defer:", err);
    }
  }, [materializeIfNeeded, activeMode, loadSmartData, loadScheduledData]);

  const enabledPrograms = programs.filter((p) => p.enabled);

  const queueSequences = (() => {
    if (activeMode === "smart") return buildSmartSequences(aiPrograms, getZoneName);

    const programSeqs = buildProgramSequences(programs, getZoneName);
    if (programEntries.length === 0) return programSeqs;

    const activeEntries = programEntries.filter((e) => e.status === "planned" || e.status === "queued" || e.status === "executing");

    const activeProgramIds = new Set(
      activeEntries.filter((e) => e.programId).map((e) => e.programId!)
    );

    const materializedSeqs = buildScheduledEntrySequences(activeEntries, getZoneName);
    materializedSeqs.forEach((s) => {
      const entry = activeEntries.find((e) => e.scheduleRunId === s.id);
      if (entry?.programId) {
        const prog = programs.find((p) => p.programId === entry.programId);
        if (prog) s.sourceLabel = prog.name;
        s.programId = entry.programId;
      }
    });

    const skippedByProgram = new Map<string, ScheduleEntry[]>();
    for (const e of programEntries) {
      if (e.status === "skipped" && e.programId && !activeProgramIds.has(e.programId)) {
        if (!skippedByProgram.has(e.programId)) skippedByProgram.set(e.programId, []);
        skippedByProgram.get(e.programId)!.push(e);
      }
    }

    const handledProgramIds = new Set([...activeProgramIds, ...skippedByProgram.keys()]);
    const remainingPrograms = programSeqs.filter((ps) => !handledProgramIds.has(ps.programId!));

    const skippedSeqs: QueueSequence[] = [];
    for (const [progId, skippedEntries] of skippedByProgram) {
      const prog = programs.find((p) => p.programId === progId);
      if (!prog) continue;
      const earliest = skippedEntries.reduce((min, e) =>
        new Date(e.plannedStartAt) < new Date(min.plannedStartAt) ? e : min
      );
      skippedSeqs.push({
        id: `skipped-${progId}`,
        scheduledAt: earliest.plannedStartAt,
        status: "skipped",
        source: "program",
        sourceLabel: prog.name,
        programId: progId,
        zones: prog.zoneEntries.map((ze) => ({
          zoneId: ze.zoneId,
          zoneName: getZoneName(ze.zoneId),
          durationMinutes: ze.durationMinutes,
        })),
        totalMinutes: prog.zoneEntries.reduce((s, e) => s + e.durationMinutes, 0),
        entryIds: skippedEntries.map((e) => e._id),
      });

      const latest = skippedEntries.reduce((max, e) =>
        new Date(e.plannedStartAt) > new Date(max.plannedStartAt) ? e : max
      );
      const nextRun = prog.scheduleCron ? nextCronRun(prog.scheduleCron, new Date(latest.plannedStartAt)) : null;
      if (nextRun) {
        skippedSeqs.push({
          id: prog.programId,
          scheduledAt: nextRun.toISOString(),
          status: "pending",
          source: "program",
          sourceLabel: prog.name,
          programId: progId,
          zones: prog.zoneEntries.map((ze) => ({
            zoneId: ze.zoneId,
            zoneName: getZoneName(ze.zoneId),
            durationMinutes: ze.durationMinutes,
          })),
          totalMinutes: prog.zoneEntries.reduce((s, e) => s + e.durationMinutes, 0),
        });
      }
    }

    return [...materializedSeqs, ...skippedSeqs, ...remainingPrograms]
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  })();

  const handleReschedule = useCallback(async (seq: QueueSequence) => {
    if (!seq.programId) return;
    try {
      await rescheduleProgramEntries(seq.programId);
      void loadScheduledData();
    } catch (err) {
      console.error("Failed to reschedule:", err);
    }
  }, [loadScheduledData]);

  const activeSequences = queueSequences.filter((s) => s.status === "pending" || s.status === "running" || s.status === "deferred" || s.status === "skipped");
  const hasQueue = activeSequences.length > 0;

  return (
    <section className="irrigation-queue-panel">
      <header className="irrigation-queue-panel__header">
        <h3>{activeMode === "smart" ? "Smart Irrigation" : "Programmed Irrigation"}</h3>
        <div className="irrigation-queue-panel__actions">
          {canToggleMode && (
            <div
              className={`irrigation-mode-toggle${activeMode === "scheduled" ? " irrigation-mode-toggle--right" : ""}`}
              role="radiogroup"
              aria-label="Irrigation source"
            >
              <span className="irrigation-mode-toggle__thumb" />
              <button
                type="button"
                role="radio"
                aria-checked={activeMode === "smart"}
                className={`irrigation-mode-toggle__btn${activeMode === "smart" ? " irrigation-mode-toggle__btn--active" : ""}`}
                onClick={() => void handleModeToggle("smart")}
                disabled={modeChanging}
                title="Smart (AI)"
                aria-label="Smart AI scheduling"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 014 4c0 1.95-1.4 3.58-3.25 3.93V12h2.75a2.5 2.5 0 012.5 2.5v1a2.5 2.5 0 01-2.5 2.5H8.5A2.5 2.5 0 016 15.5v-1A2.5 2.5 0 018.5 12h2.75V9.93A4.002 4.002 0 018 6a4 4 0 014-4z" /><path d="M10 18v2a2 2 0 104 0v-2" /><circle cx="10" cy="6" r="0.5" fill="currentColor" /><circle cx="14" cy="6" r="0.5" fill="currentColor" /></svg>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={activeMode === "scheduled"}
                className={`irrigation-mode-toggle__btn${activeMode === "scheduled" ? " irrigation-mode-toggle__btn--active" : ""}`}
                onClick={() => void handleModeToggle("scheduled")}
                disabled={modeChanging}
                title="Scheduled"
                aria-label="Scheduled programs"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
              </button>
            </div>
          )}
          <button
            type="button"
            className="ghost-button icon-btn"
            onClick={activeMode === "smart" ? onOpenSmartSettings : onOpenProgramSettings}
            title={activeMode === "smart" ? "Configure AI scheduling" : "Manage programs"}
            aria-label={activeMode === "smart" ? "Configure AI scheduling" : "Manage programs"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
          </button>
        </div>
      </header>

      {activeMode === "scheduled" && (
        <p className="muted" style={{ fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }}>
          {enabledPrograms.length > 0
            ? `${enabledPrograms.length} active program${enabledPrograms.length !== 1 ? "s" : ""}`
            : "No active programs. Add programs in Settings."}
        </p>
      )}

      {error && <p className="zone-control-panel__error">{error}</p>}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : !hasQueue ? (
        <div className="irrigation-queue-empty">
          <p className="muted">
            {activeMode === "smart"
              ? config?.enabled
                ? "No scheduled programs yet. The AI scheduler will run automatically."
                : "Enable AI scheduling in settings to get started."
              : "No active programs. Add and enable programs in Settings."}
          </p>
        </div>
      ) : (
        <>
          {hasQueue && (
            <div className="schedule-entries-list">
              <h4>Queue</h4>
              <div className="schedule-entries-grid">
                {activeSequences.map((seq) => (
                  <QueueSequenceCard
                    key={seq.id}
                    seq={seq}
                    onSkip={handleSkipSequence}
                    onDefer={handleDeferSequence}
                    onReschedule={handleReschedule}
                  />
                ))}
              </div>
            </div>
          )}

        </>
      )}
    </section>
  );
};

export default IrrigationQueuePanel;
