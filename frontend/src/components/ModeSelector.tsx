import type { ReactNode } from "react";
import type { IrrigationMode } from "../types";

interface ModeSelectorProps {
  mode: IrrigationMode;
  onChange: (mode: IrrigationMode) => void;
  disabled?: boolean;
}

const MODES: { value: IrrigationMode; label: string; icon: ReactNode }[] = [
  {
    value: "smart",
    label: "Smart",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" />
        <line x1="10" y1="22" x2="14" y2="22" />
      </svg>
    )
  },
  {
    value: "manual",
    label: "Manual",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8h1a4 4 0 010 8h-1" /><path d="M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" />
      </svg>
    )
  },
  {
    value: "scheduled",
    label: "Scheduled",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    )
  }
];

const ModeSelector = ({ mode, onChange, disabled }: ModeSelectorProps) => (
  <div className="mode-selector" role="radiogroup" aria-label="Irrigation mode">
    {MODES.map((m) => (
      <button
        key={m.value}
        type="button"
        role="radio"
        aria-checked={mode === m.value}
        className={`mode-selector__btn${mode === m.value ? " mode-selector__btn--active" : ""}`}
        onClick={() => onChange(m.value)}
        disabled={disabled}
      >
        {m.icon}
        <span>{m.label}</span>
      </button>
    ))}
  </div>
);

export default ModeSelector;
