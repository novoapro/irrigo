import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IrrigationRecord, ManualRun, Zone, ZoneState } from "../types";
import ZoneCard from "./ZoneCard";
import type { ZoneIrrigationSummary } from "./ZoneCard";
import { getPersistedDuration } from "./ZoneCard";
import ZoneFormModal from "./ZoneFormModal";
import {
  createZone as apiCreateZone,
  updateZone as apiUpdateZone,
  deleteZone as apiDeleteZone,
  toggleZone as apiToggleZone,
  sendZoneCommand,
  triggerManualRun,
  cancelManualRun
} from "../api";

interface ZoneControlPanelProps {
  zones: Zone[];
  zoneStates: Record<string, ZoneState>;
  loading: boolean;
  onZonesChanged: () => void;
  mode?: "control" | "manage";
  onOpenSettings?: () => void;
  irrigationRecords?: IrrigationRecord[];
  baselinePsi?: number | null;
  manualRun?: ManualRun | null;
  guardActive?: boolean;
}

function buildZoneSummaries(records: IrrigationRecord[]): Record<string, ZoneIrrigationSummary> {
  const result: Record<string, ZoneIrrigationSummary> = {};
  for (const r of records) {
    if (result[r.zoneId]) continue;
    result[r.zoneId] = {
      start: r.startedAt,
      end: r.endedAt ?? null,
      durationMs: r.durationMs ?? 0,
      isRunning: r.status === "running",
      pressureStart: r.pressureStart ?? null,
      pressureEnd: r.pressureEnd ?? null,
    };
  }
  return result;
}

const COMMAND_CONFIRM_TIMEOUT_MS = 15_000;

const ZoneControlPanel = ({ zones, zoneStates, loading, onZonesChanged, mode = "control", onOpenSettings, irrigationRecords, baselinePsi, manualRun, guardActive }: ZoneControlPanelProps) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [pendingCommands, setPendingCommands] = useState<Set<string>>(new Set());
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<Record<string, { expectedActive: boolean; durationMinutes?: number }>>({});
  const confirmTimersRef = useRef<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [guardConfirmAction, setGuardConfirmAction] = useState<(() => void) | null>(null);

  const isManage = mode === "manage";
  const zoneSummaries = useMemo(
    () => (irrigationRecords ? buildZoneSummaries(irrigationRecords) : {}),
    [irrigationRecords]
  );

  const handleAddClick = useCallback(() => {
    setEditingZone(null);
    setFormOpen(true);
    setError(null);
  }, []);

  const handleEdit = useCallback((zone: Zone) => {
    setEditingZone(zone);
    setFormOpen(true);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    setFormOpen(false);
    setEditingZone(null);
  }, []);

  const handleSave = useCallback(
    async (data: Partial<Zone> & { zoneId: string; name: string; defaultDurationMinutes: number }) => {
      if (editingZone) {
        const { zoneId, ...updates } = data;
        await apiUpdateZone(editingZone.zoneId, updates);
      } else {
        await apiCreateZone(data as Zone);
      }
      onZonesChanged();
    },
    [editingZone, onZonesChanged]
  );

  const handleDelete = useCallback(async () => {
    if (!editingZone) return;
    await apiDeleteZone(editingZone.zoneId);
    onZonesChanged();
  }, [editingZone, onZonesChanged]);

  const handleToggleEnabled = useCallback(
    async (zoneId: string) => {
      try {
        await apiToggleZone(zoneId);
        onZonesChanged();
      } catch (err) {
        console.error("Failed to toggle zone:", err);
      }
    },
    [onZonesChanged]
  );

  const clearConfirmation = useCallback((zoneId: string) => {
    setAwaitingConfirmation((prev) => {
      const next = { ...prev };
      delete next[zoneId];
      return next;
    });
    if (confirmTimersRef.current[zoneId]) {
      window.clearTimeout(confirmTimersRef.current[zoneId]);
      delete confirmTimersRef.current[zoneId];
    }
  }, []);

  useEffect(() => {
    // Reconcile pending command confirmations against the latest (realtime)
    // zone states: once a zone reaches its expected state, drop the pending
    // confirmation and its timeout. This reacts to external state changes, so
    // the state update legitimately lives in an effect.
    const awaiting = Object.entries(awaitingConfirmation);
    for (const [zoneId, { expectedActive }] of awaiting) {
      const currentActive = zoneStates[zoneId]?.isActive ?? false;
      if (currentActive === expectedActive) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        clearConfirmation(zoneId);
      }
    }
  }, [zoneStates, awaitingConfirmation, clearConfirmation]);

  useEffect(() => {
    const timers = confirmTimersRef.current;
    return () => {
      for (const id of Object.values(timers)) window.clearTimeout(id);
    };
  }, []);

  const executeCommand = useCallback(
    async (zoneId: string, action: "on" | "off", durationMinutes?: number) => {
      setPendingCommands((prev) => new Set(prev).add(zoneId));
      setError(null);
      try {
        await sendZoneCommand(zoneId, { action, durationMinutes });
        onZonesChanged();

        setPendingCommands((prev) => {
          const next = new Set(prev);
          next.delete(zoneId);
          return next;
        });

        const expectedActive = action === "on";
        setAwaitingConfirmation((prev) => ({ ...prev, [zoneId]: { expectedActive, durationMinutes } }));

        if (confirmTimersRef.current[zoneId]) {
          window.clearTimeout(confirmTimersRef.current[zoneId]);
        }
        confirmTimersRef.current[zoneId] = window.setTimeout(() => {
          clearConfirmation(zoneId);
        }, COMMAND_CONFIRM_TIMEOUT_MS);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Command failed");
        setPendingCommands((prev) => {
          const next = new Set(prev);
          next.delete(zoneId);
          return next;
        });
      }
    },
    [onZonesChanged, clearConfirmation]
  );

  const handleCommand = useCallback(
    (zoneId: string, action: "on" | "off", durationMinutes?: number) => {
      if (action === "on" && guardActive) {
        setGuardConfirmAction(() => () => void executeCommand(zoneId, action, durationMinutes));
      } else {
        void executeCommand(zoneId, action, durationMinutes);
      }
    },
    [guardActive, executeCommand]
  );

  const isManualRunActive = manualRun?.status === "running";
  const manualRunZoneIds = useMemo(
    () => manualRun?.zones.map((z) => z.zoneId) ?? [],
    [manualRun]
  );
  const anyManualRunZoneActive = manualRunZoneIds.some((id) => zoneStates[id]?.isActive);

  // Latched action flags that must clear when the manual run actually
  // starts/stops (observed via realtime zone states) — not derivable in render
  // without losing the latch. Reacting to that external transition in an effect
  // is the intended use.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (runningAll && anyManualRunZoneActive) setRunningAll(false);
  }, [runningAll, anyManualRunZoneActive]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cancelling && !anyManualRunZoneActive) setCancelling(false);
  }, [cancelling, anyManualRunZoneActive]);

  const enabledZones = zones.filter((z) => z.enabled);
  const eligibleZones = enabledZones.filter((z) => !z.excludeFromManualRun);

  const executeRunAll = useCallback(async () => {
    setRunningAll(true);
    setError(null);
    try {
      const overrides = eligibleZones.map((z) => ({
        zoneId: z.zoneId,
        durationMinutes: getPersistedDuration(z.zoneId, z.defaultDurationMinutes)
      }));
      await triggerManualRun(overrides);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
      setRunningAll(false);
    }
  }, [eligibleZones]);

  const handleRunAll = useCallback(() => {
    if (guardActive) {
      setGuardConfirmAction(() => () => void executeRunAll());
    } else {
      void executeRunAll();
    }
  }, [guardActive, executeRunAll]);

  const handleCancelRun = useCallback(async () => {
    setCancelling(true);
    setError(null);
    try {
      await cancelManualRun();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
      setCancelling(false);
    }
  }, []);

  const handleToggleManualRunExclusion = useCallback(async (zone: Zone) => {
    try {
      await apiUpdateZone(zone.zoneId, { excludeFromManualRun: !zone.excludeFromManualRun });
      onZonesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    }
  }, [onZonesChanged]);

  const manualRunZoneMap = useMemo(() => {
    if (!manualRun) return {};
    const map: Record<string, (typeof manualRun.zones)[number]> = {};
    for (const entry of manualRun.zones) {
      map[entry.zoneId] = entry;
    }
    return map;
  }, [manualRun]);

  return (
    <section className={`zone-control-panel${isManage ? " zone-control-panel--manage" : ""}`}>
      <header className="zone-control-panel__header">
        <h3>Zones{!isManage && ` (${enabledZones.length})`}</h3>
        {isManage ? (
          <button type="button" className="primary-button icon-btn" onClick={handleAddClick} title="Add zone" aria-label="Add zone">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        ) : (
          <div className="zone-control-panel__actions">
            <button
              type="button"
              className={`zone-control-panel__run-btn${isManualRunActive ? " zone-control-panel__run-btn--active" : ""}`}
              onClick={isManualRunActive ? handleCancelRun : handleRunAll}
              disabled={cancelling || runningAll || (!isManualRunActive && eligibleZones.length === 0)}
              title={cancelling ? "Stopping..." : runningAll ? "Starting..." : isManualRunActive ? "Stop manual program" : "Run manual program"}
              aria-label={cancelling ? "Stopping..." : runningAll ? "Starting..." : isManualRunActive ? "Stop manual program" : "Run manual program"}
            >
              {cancelling || runningAll ? (
                <svg className="icon-spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
              ) : isManualRunActive ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              )}
            </button>
            {onOpenSettings && (
              <button
                type="button"
                className="ghost-button icon-btn"
                onClick={onOpenSettings}
                aria-label="Manage zones"
                title="Manage zones"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
              </button>
            )}
          </div>
        )}
      </header>

      {error && <p className="zone-control-panel__error">{error}</p>}

      {loading && zones.length === 0 ? (
        <p className="muted">Loading zones...</p>
      ) : (isManage ? zones : enabledZones).length === 0 ? (
        <div className="zone-empty-state">
          <p className="muted">
            {isManage
              ? "No zones configured yet. Add your first zone to get started."
              : "Configure your irrigation zones in Settings to start controlling them."}
          </p>
        </div>
      ) : (
        <div className="zone-grid">
          {(isManage ? zones : enabledZones).map((zone) => (
            <ZoneCard
              key={zone.zoneId}
              zone={zone}
              state={zoneStates[zone.zoneId] ?? null}
              onEdit={isManage ? handleEdit : undefined}
              onToggleEnabled={handleToggleEnabled}
              onCommand={handleCommand}
              commandPending={pendingCommands.has(zone.zoneId)}
              awaitingConfirmation={awaitingConfirmation[zone.zoneId] ?? null}
              lastIrrigation={zoneSummaries[zone.zoneId] ?? null}
              baselinePsi={baselinePsi}
              locked={runningAll}
              manualRunActive={isManualRunActive || cancelling}
              manualRunZoneEntry={manualRunZoneMap[zone.zoneId] ?? null}
              onToggleManualRunExclusion={isManage ? undefined : handleToggleManualRunExclusion}
            />
          ))}
        </div>
      )}

      {isManage && (
        <ZoneFormModal
          zone={editingZone}
          existingZones={zones}
          open={formOpen}
          onSave={handleSave}
          onDelete={editingZone ? handleDelete : undefined}
          onClose={handleClose}
        />
      )}

      {guardConfirmAction && createPortal(
        <div className="modal-overlay confirm-dialog-overlay" role="alertdialog" aria-modal="true">
          <div className="confirm-dialog">
            <div className="confirm-dialog__icon" style={{ background: "var(--color-warning-bg)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            </div>
            <h3 className="confirm-dialog__title">Guard is active</h3>
            <p className="confirm-dialog__message">
              The irrigation guard is on — conditions are not ideal for irrigation. Do you still want to proceed?
            </p>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setGuardConfirmAction(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => { guardConfirmAction(); setGuardConfirmAction(null); }}
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

export default ZoneControlPanel;
