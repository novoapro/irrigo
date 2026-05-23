import type { PreferredTimeWindow } from "../types";
import Dropdown from "./Dropdown";

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${i.toString().padStart(2, "0")}:00`,
}));

interface PreferredTimeWindowsEditorProps {
  windows: PreferredTimeWindow[];
  onChange: (windows: PreferredTimeWindow[]) => void;
}

const PreferredTimeWindowsEditor = ({ windows, onChange }: PreferredTimeWindowsEditorProps) => {
  const updateWindow = (index: number, field: "startHour" | "endHour", value: number) => {
    const updated = [...windows];
    updated[index] = { ...updated[index]!, [field]: value };
    onChange(updated);
  };

  const addWindow = () => {
    onChange([...windows, { startHour: 20, endHour: 6 }]);
  };

  const removeWindow = (index: number) => {
    onChange(windows.filter((_, i) => i !== index));
  };

  return (
    <div className="preferred-time-windows">
      {windows.map((w, i) => (
        <div className="time-window-row" key={i}>
          <div className="form-group time-window-field">
            <label>From</label>
            <Dropdown
              value={String(w.startHour)}
              options={HOUR_OPTIONS}
              onChange={(v) => updateWindow(i, "startHour", parseInt(v, 10))}
            />
          </div>
          <div className="form-group time-window-field">
            <label>To</label>
            <Dropdown
              value={String(w.endHour)}
              options={HOUR_OPTIONS}
              onChange={(v) => updateWindow(i, "endHour", parseInt(v, 10))}
            />
          </div>
          {windows.length > 1 && (
            <button
              type="button"
              className="ghost-button icon-btn danger-text time-window-remove"
              onClick={() => removeWindow(i)}
              aria-label="Remove window"
              title="Remove window"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
      ))}
      <button type="button" className="ghost-button icon-btn time-window-add" onClick={addWindow} aria-label="Add window" title="Add window">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
      </button>
    </div>
  );
};

export default PreferredTimeWindowsEditor;
