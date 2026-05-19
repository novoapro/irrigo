import { useCallback, useMemo, useState } from "react";
import type { IrrigationEvent, Zone, ZoneState } from "../types";
import ZoneCard from "./ZoneCard";
import type { ZoneIrrigationSummary } from "./ZoneCard";
import ZoneFormModal from "./ZoneFormModal";
import {
  createZone as apiCreateZone,
  updateZone as apiUpdateZone,
  deleteZone as apiDeleteZone,
  toggleZone as apiToggleZone,
  sendZoneCommand,
  triggerManualRun
} from "../api";

interface ZoneControlPanelProps {
  zones: Zone[];
  zoneStates: Record<string, ZoneState>;
  loading: boolean;
  onZonesChanged: () => void;
  mode?: "control" | "manage";
  onOpenSettings?: () => void;
  irrigationEvents?: IrrigationEvent[];
  baselinePsi?: number | null;
}

function buildZoneSummaries(events: IrrigationEvent[]): Record<string, ZoneIrrigationSummary> {
  const now = Date.now();
  const sorted = [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const openByZone = new Map<string, IrrigationEvent>();
  const lastCycleByZone = new Map<string, { on: IrrigationEvent; off?: IrrigationEvent }>();

  for (const event of sorted) {
    if (event.action === "on") {
      openByZone.set(event.zone, event);
    } else {
      const open = openByZone.get(event.zone);
      if (open) {
        lastCycleByZone.set(event.zone, { on: open, off: event });
        openByZone.delete(event.zone);
      }
    }
  }
  openByZone.forEach((onEvent, zone) => {
    lastCycleByZone.set(zone, { on: onEvent, off: undefined });
  });

  const result: Record<string, ZoneIrrigationSummary> = {};
  lastCycleByZone.forEach(({ on, off }, zone) => {
    const startTime = new Date(on.createdAt).getTime();
    const endTime = off ? new Date(off.createdAt).getTime() : now;
    result[zone] = {
      start: on.createdAt,
      end: off?.createdAt ?? null,
      durationMs: Math.max(0, endTime - startTime),
      isRunning: !off,
      pressureStart: on.waterPressure ?? null,
      pressureEnd: off?.waterPressure ?? null,
    };
  });
  return result;
}

const ZoneControlPanel = ({ zones, zoneStates, loading, onZonesChanged, mode = "control", onOpenSettings, irrigationEvents, baselinePsi }: ZoneControlPanelProps) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<Zone | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingCommands, setPendingCommands] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);

  const isManage = mode === "manage";
  const zoneSummaries = useMemo(
    () => (irrigationEvents ? buildZoneSummaries(irrigationEvents) : {}),
    [irrigationEvents]
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
      setSaving(true);
      setError(null);
      try {
        if (editingZone) {
          const { zoneId, ...updates } = data;
          await apiUpdateZone(editingZone.zoneId, updates);
        } else {
          await apiCreateZone(data as Zone);
        }
        setFormOpen(false);
        setEditingZone(null);
        onZonesChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save zone");
      } finally {
        setSaving(false);
      }
    },
    [editingZone, onZonesChanged]
  );

  const handleDelete = useCallback(async () => {
    if (!editingZone) return;
    setSaving(true);
    setError(null);
    try {
      await apiDeleteZone(editingZone.zoneId);
      setFormOpen(false);
      setEditingZone(null);
      onZonesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete zone");
    } finally {
      setSaving(false);
    }
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

  const handleCommand = useCallback(
    async (zoneId: string, action: "on" | "off", durationMinutes?: number) => {
      setPendingCommands((prev) => new Set(prev).add(zoneId));
      setError(null);
      try {
        await sendZoneCommand(zoneId, { action, durationMinutes });
        onZonesChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Command failed");
      } finally {
        setPendingCommands((prev) => {
          const next = new Set(prev);
          next.delete(zoneId);
          return next;
        });
      }
    },
    [onZonesChanged]
  );

  const handleRunAll = useCallback(async () => {
    setRunningAll(true);
    setError(null);
    try {
      await triggerManualRun();
      onZonesChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setRunningAll(false);
    }
  }, [onZonesChanged]);

  const enabledZones = zones.filter((z) => z.enabled);

  return (
    <section className={`zone-control-panel${isManage ? " zone-control-panel--manage" : ""}`}>
      <header className="zone-control-panel__header">
        <h3>Zones{!isManage && ` (${zones.length})`}</h3>
        {isManage ? (
          <button type="button" className="primary-button icon-btn" onClick={handleAddClick} title="Add zone" aria-label="Add zone">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        ) : (
          <div className="zone-control-panel__actions">
            <button
              type="button"
              className="primary-button icon-btn"
              onClick={handleRunAll}
              disabled={runningAll || enabledZones.length === 0}
              title={runningAll ? "Running..." : "Run all zones"}
              aria-label={runningAll ? "Running all zones" : "Run all zones"}
            >
              {runningAll ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3" /></svg>
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
      ) : zones.length === 0 ? (
        <div className="zone-empty-state">
          <p className="muted">
            {isManage
              ? "No zones configured yet. Add your first zone to get started."
              : "Configure your irrigation zones in Settings to start controlling them."}
          </p>
        </div>
      ) : (
        <div className="zone-grid">
          {zones.map((zone) => (
            <ZoneCard
              key={zone.zoneId}
              zone={zone}
              state={zoneStates[zone.zoneId] ?? null}
              onEdit={isManage ? handleEdit : undefined}
              onToggleEnabled={handleToggleEnabled}
              onCommand={handleCommand}
              commandPending={pendingCommands.has(zone.zoneId)}
              lastIrrigation={zoneSummaries[zone.zoneId] ?? null}
              baselinePsi={baselinePsi}
            />
          ))}
        </div>
      )}

      {isManage && (
        <ZoneFormModal
          zone={editingZone}
          existingZones={zones}
          open={formOpen}
          saving={saving}
          onSave={handleSave}
          onDelete={editingZone ? handleDelete : undefined}
          onClose={handleClose}
        />
      )}
    </section>
  );
};

export default ZoneControlPanel;
