/**
 * ZoneControlPanel — the grid of irrigation zones, and the brain behind
 * turning zones on/off.
 *
 * It renders a header (title + actions) and a `<ZoneCard>` per zone. Its most
 * interesting responsibility is the **optimistic command flow with out-of-band
 * confirmation**:
 *
 *  1. The user taps a zone toggle -> `handleCommand` -> `executeCommand`.
 *  2. `executeCommand` marks the zone as `pendingCommands` (spinner) and POSTs
 *     the on/off command via `sendZoneCommand`. Awaiting that POST only tells us
 *     the controller *accepted* the command, NOT that the valve actually moved.
 *  3. So once the POST resolves we drop `pendingCommands` and instead record an
 *     `awaitingConfirmation` entry: "I expect this zone to become on/off".
 *  4. The real confirmation arrives *out of band*: the controller later emits a
 *     realtime `zoneState:changed` event, which flows into this component as an
 *     updated `zoneStates` prop. An effect (below) watches `zoneStates` and, when
 *     a zone reaches its `expectedActive` value, clears the confirmation.
 *  5. A safety timeout (`COMMAND_CONFIRM_TIMEOUT_MS`) clears the confirmation if
 *     no realtime event ever arrives, so the UI never gets stuck spinning.
 *
 * This "await the request, but confirm via a separate realtime channel" split is
 * the key concept — the awaited POST and the confirming event are two different
 * things.
 *
 * Dual `mode` prop:
 *  - `"control"` (default): the operational dashboard. Shows only enabled zones,
 *    a Run-All manual program button, on/off toggles, and manual-run exclusion.
 *  - `"manage"`: the settings/CRUD view. Shows *all* zones plus add/edit/delete
 *    controls (via `ZoneFormModal`) and hides the run controls.
 * One component serves both screens; `isManage` gates which UI branches render.
 *
 * Key props:
 *  - `zones` / `zoneStates`: the configured zones and their live realtime state.
 *  - `onZonesChanged`: callback asking the parent to refetch after a mutation.
 *  - `mode`: `"control" | "manage"` (see above).
 *  - `guardActive`: when true, starting irrigation first pops a confirm dialog
 *    because conditions are flagged as unsuitable.
 *  - `manualRun`: the in-progress "run all zones" sequence, if any.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IrrigationRecord, ManualRun, Zone, ZoneState } from "../types";
import ZoneCard from "./ZoneCard";
import type { ZoneIrrigationSummary } from "./ZoneCard";
import { getPersistedDuration } from "../utils/zoneDuration";
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

/**
 * Collapse a flat list of irrigation records into "the latest record per zone".
 * `records` is assumed newest-first, so the first record seen for a zone wins and
 * later (older) ones are skipped.
 */
function buildZoneSummaries(records: IrrigationRecord[]): Record<string, ZoneIrrigationSummary> {
  const result: Record<string, ZoneIrrigationSummary> = {};
  for (const r of records) {
    if (result[r.zoneId]) continue; // already captured the newest record for this zone
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

// How long to keep waiting for a realtime `zoneState:changed` confirmation
// before giving up and clearing the pending state, so a dropped event can't
// leave a zone spinning forever.
const COMMAND_CONFIRM_TIMEOUT_MS = 15_000;

const ZoneControlPanel = ({ zones, zoneStates, loading, onZonesChanged, mode = "control", onOpenSettings, irrigationRecords, baselinePsi, manualRun, guardActive }: ZoneControlPanelProps) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  // Zones whose command POST is still in flight (show a spinner). Cleared as soon
  // as the request resolves, at which point the zone moves to awaitingConfirmation.
  const [pendingCommands, setPendingCommands] = useState<Set<string>>(new Set());
  // Zones whose command was accepted but whose valve hasn't yet reported the
  // expected state via realtime. Keyed by zoneId -> the state we're waiting for.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<Record<string, { expectedActive: boolean; durationMinutes?: number }>>({});
  // Per-zone safety timeouts (kept in a ref, not state, since changing them must
  // not trigger a re-render).
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

  // Drop a zone's pending confirmation and cancel its safety timeout. Called both
  // when the realtime event confirms the change and when the timeout fires.
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
    // This is step 4 of the optimistic-command flow described at the top of the
    // file: reconcile local "awaiting" UI state against incoming realtime zone
    // states. When a zone reaches the state we expected, drop the pending
    // confirmation and its timeout. Because it *reacts* to an external change
    // (the realtime prop) rather than deriving from render inputs, updating state
    // here is legitimate — hence the deliberate `eslint-disable` on the setState.
    const awaiting = Object.entries(awaitingConfirmation);
    for (const [zoneId, { expectedActive }] of awaiting) {
      const currentActive = zoneStates[zoneId]?.isActive ?? false;
      if (currentActive === expectedActive) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        clearConfirmation(zoneId);
      }
    }
  }, [zoneStates, awaitingConfirmation, clearConfirmation]);

  // Clean up any outstanding safety timeouts when the panel unmounts.
  useEffect(() => {
    const timers = confirmTimersRef.current;
    return () => {
      for (const id of Object.values(timers)) window.clearTimeout(id);
    };
  }, []);

  // The optimistic command flow itself (steps 1-3 + 5 from the top-of-file docs).
  const executeCommand = useCallback(
    async (zoneId: string, action: "on" | "off", durationMinutes?: number) => {
      // Step 2: show a spinner and fire the command.
      setPendingCommands((prev) => new Set(prev).add(zoneId));
      setError(null);
      try {
        // Awaiting this only confirms the controller *accepted* the command.
        await sendZoneCommand(zoneId, { action, durationMinutes });
        onZonesChanged();

        // Step 3: request done -> stop spinning, but we still don't trust the
        // valve moved. Move the zone into "awaiting realtime confirmation".
        setPendingCommands((prev) => {
          const next = new Set(prev);
          next.delete(zoneId);
          return next;
        });

        const expectedActive = action === "on";
        setAwaitingConfirmation((prev) => ({ ...prev, [zoneId]: { expectedActive, durationMinutes } }));

        // Step 5: arm the safety timeout in case the realtime event never lands.
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

  // Entry point from each ZoneCard. When the guard is active and the user is
  // trying to turn a zone ON, we stash the intended command as a thunk and let
  // the confirm dialog decide whether to run it. (Storing a function in state
  // needs the `() => () => ...` form, since a bare updater would be *called* by
  // setState instead of stored.)
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

  // ── Manual "run all zones" program state ──
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

  // Derived lists (recomputed every render — cheap, no memo needed).
  // enabledZones drives the control view; eligibleZones is the subset that a
  // manual "run all" will actually water (some zones opt out).
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

  // Index the manual run's per-zone entries by zoneId so each ZoneCard can look up
  // its own step (status, progress) in O(1) rather than scanning the array.
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
          {/* Manage mode lists every zone; control mode only enabled ones. Each
              ZoneCard keeps its own local state (selected duration, countdown),
              so the list key must be the stable `zoneId` — using an array index
              would let React reuse a card's state for a different zone. */}
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

      {/* Guard confirmation dialog. Rendered through a portal into <body> so it
          escapes the panel's stacking/overflow context and overlays the page.
          Clicking "Proceed anyway" runs the stashed command thunk. */}
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
