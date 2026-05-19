import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Zone, ZoneMetadata } from "../types";
import Dropdown from "./Dropdown";

const PLANT_TYPES = [
  { value: "", label: "—" },
  { value: "grass", label: "Grass / Turf" },
  { value: "shrubs", label: "Shrubs" },
  { value: "trees", label: "Trees" },
  { value: "flower-beds", label: "Flower Beds" },
  { value: "vegetable-garden", label: "Vegetable Garden" },
  { value: "herb-garden", label: "Herb Garden" },
  { value: "ground-cover", label: "Ground Cover" },
  { value: "native-plants", label: "Native / Drought-Tolerant" },
  { value: "mixed", label: "Mixed Planting" },
];

const SOIL_TYPES = [
  { value: "", label: "—" },
  { value: "clay", label: "Clay" },
  { value: "sandy", label: "Sandy" },
  { value: "loam", label: "Loam" },
  { value: "silt", label: "Silt" },
  { value: "clay-loam", label: "Clay Loam" },
  { value: "sandy-loam", label: "Sandy Loam" },
  { value: "chalky", label: "Chalky" },
  { value: "peaty", label: "Peaty" },
];

const SUN_OPTIONS = [
  { value: "", label: "—" },
  { value: "full", label: "Full Sun" },
  { value: "partial", label: "Partial" },
  { value: "shade", label: "Shade" },
];

interface ZoneFormModalProps {
  zone?: Zone | null;
  existingZones: Zone[];
  open: boolean;
  saving: boolean;
  onSave: (data: Partial<Zone> & { zoneId: string; name: string; defaultDurationMinutes: number }) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const getUniqueSlug = (base: string, existingIds: string[]): string => {
  if (!existingIds.includes(base)) return base;
  let counter = 2;
  while (existingIds.includes(`${base}-${counter}`)) counter++;
  return `${base}-${counter}`;
};

const EMPTY_METADATA: ZoneMetadata = {};

const ZoneFormModal = ({ zone, existingZones, open, saving, onSave, onDelete, onClose }: ZoneFormModalProps) => {
  const isEdit = Boolean(zone);

  const [zoneId, setZoneId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultDuration, setDefaultDuration] = useState(15);
  const [maxDuration, setMaxDuration] = useState(60);
  const [enabled, setEnabled] = useState(true);
  const [plantType, setPlantType] = useState("");
  const [sunExposure, setSunExposure] = useState<"" | "full" | "partial" | "shade">("");
  const [soilType, setSoilType] = useState("");
  const [area, setArea] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (zone) {
      setZoneId(zone.zoneId);
      setName(zone.name);
      setDescription(zone.description ?? "");
      setDefaultDuration(zone.defaultDurationMinutes);
      setMaxDuration(zone.maxDurationMinutes);
      setEnabled(zone.enabled);
      setPlantType(zone.metadata?.plantType ?? "");
      setSunExposure((zone.metadata?.sunExposure as "" | "full" | "partial" | "shade") ?? "");
      setSoilType(zone.metadata?.soilType ?? "");
      setArea(zone.metadata?.area?.toString() ?? "");
      setNotes(zone.metadata?.notes ?? "");
    } else {
      setZoneId("");
      setName("");
      setDescription("");
      setDefaultDuration(15);
      setMaxDuration(60);
      setEnabled(true);
      setPlantType("");
      setSunExposure("");
      setSoilType("");
      setArea("");
      setNotes("");
    }
    setConfirmDelete(false);
  }, [zone, open]);

  useEffect(() => {
    if (isEdit) return;
    const slug = slugify(name);
    if (!slug) { setZoneId(""); return; }
    const otherIds = existingZones.map(z => z.zoneId);
    setZoneId(getUniqueSlug(slug, otherIds));
  }, [name, isEdit, existingZones]);

  const handleSubmit = useCallback(() => {
    const metadata: ZoneMetadata = {};
    if (plantType) metadata.plantType = plantType;
    if (sunExposure) metadata.sunExposure = sunExposure;
    if (soilType) metadata.soilType = soilType;
    if (area && !Number.isNaN(Number(area))) metadata.area = Number(area);
    if (notes) metadata.notes = notes;

    onSave({
      zoneId,
      name,
      description: description || undefined,
      defaultDurationMinutes: defaultDuration,
      maxDurationMinutes: maxDuration,
      enabled,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined
    });
  }, [zoneId, name, description, defaultDuration, maxDuration, enabled, plantType, sunExposure, soilType, area, notes, onSave]);

  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-content">
        <header className="modal-header">
          <h2>{isEdit ? "Edit Zone" : "Add Zone"}</h2>
          <button
            type="button"
            className="settings-panel__close"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </header>

        <div className="modal-body">
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <div className="zone-form-top-row">
              <div className="zone-form-id">
                <span className="zone-form-id__label">Zone ID</span>
                <span className="zone-form-id__value">{zoneId || "—"}</span>
              </div>
              <label
                className={`toggle-switch${enabled ? " toggle-switch--on" : ""}`}
                role="switch"
                aria-checked={enabled}
                aria-label="Enable zone"
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                />
                <span className="toggle-switch__track">
                  <span className="toggle-switch__thumb" />
                </span>
              </label>
            </div>

            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                value={name}
                placeholder="Front Lawn"
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus={!isEdit}
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <input
                type="text"
                value={description}
                placeholder="Optional description"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Default Duration (min)</label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  value={defaultDuration}
                  onChange={(e) => setDefaultDuration(parseInt(e.target.value, 10) || 15)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Max Duration (min)</label>
                <input
                  type="number"
                  min="1"
                  max="240"
                  value={maxDuration}
                  onChange={(e) => setMaxDuration(parseInt(e.target.value, 10) || 60)}
                />
              </div>
            </div>

            <fieldset className="form-fieldset">
              <legend>Metadata</legend>

              <div className="form-row">
                <div className="form-group">
                  <label>Plant Type</label>
                  <Dropdown
                    value={plantType}
                    options={PLANT_TYPES}
                    onChange={setPlantType}
                  />
                </div>
                <div className="form-group">
                  <label>Sun Exposure</label>
                  <Dropdown
                    value={sunExposure}
                    options={SUN_OPTIONS}
                    onChange={(v) => setSunExposure(v as "" | "full" | "partial" | "shade")}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Soil Type</label>
                  <Dropdown
                    value={soilType}
                    options={SOIL_TYPES}
                    onChange={setSoilType}
                  />
                </div>
                <div className="form-group">
                  <label>Area (sq ft)</label>
                  <input
                    type="number"
                    min="0"
                    value={area}
                    placeholder="0"
                    onChange={(e) => setArea(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Notes</label>
                <input
                  type="text"
                  value={notes}
                  placeholder="Optional notes"
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </fieldset>

            <div className="form-actions">
              {isEdit && onDelete && (
                <button
                  type="button"
                  className="ghost-button icon-btn danger-text"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete zone"
                  title="Delete zone"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
                </button>
              )}
              <div className="form-actions-right">
                <button
                  type="button"
                  className="ghost-button icon-btn danger-text"
                  onClick={onClose}
                  aria-label="Cancel"
                  title="Cancel"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
                <button
                  type="submit"
                  className="primary-button icon-btn"
                  disabled={saving || !zoneId || !name}
                  aria-label={saving ? "Saving..." : isEdit ? "Save changes" : "Create zone"}
                  title={saving ? "Saving..." : isEdit ? "Save changes" : "Create zone"}
                >
                  {saving
                    ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon-spin"><path d="M21 12a9 9 0 11-6.219-8.56" /></svg>
                    : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  }
                </button>
              </div>
            </div>
          </form>
        </div>

        {confirmDelete && createPortal(
          <div className="modal-overlay confirm-dialog-overlay" role="alertdialog" aria-modal="true">
            <div className="confirm-dialog">
              <div className="confirm-dialog__icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></svg>
              </div>
              <h3 className="confirm-dialog__title">Delete zone</h3>
              <p className="confirm-dialog__message">
                Are you sure you want to delete <strong>{name || "this zone"}</strong>? This action cannot be undone.
              </p>
              <div className="confirm-dialog__actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="danger-button"
                  onClick={onDelete}
                  disabled={saving}
                >
                  {saving ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>,
    document.body
  );
};

export default ZoneFormModal;
