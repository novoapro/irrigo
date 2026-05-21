import { useRef } from "react";

interface DateTimeInputProps {
  value: Date | null;
  onChange: (date: Date | null) => void;
  min?: Date;
  max?: Date;
  placeholder?: string;
  clearable?: boolean;
}

const toLocalISOString = (d: Date): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
};

const DateTimeInput = ({ value, onChange, min, max, placeholder, clearable = false }: DateTimeInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="datetime-input-wrapper">
      <input
        ref={inputRef}
        type="datetime-local"
        className="datetime-input"
        value={value ? toLocalISOString(value) : ""}
        min={min ? toLocalISOString(min) : undefined}
        max={max ? toLocalISOString(max) : undefined}
        placeholder={placeholder}
        onChange={(e) => {
          const val = e.target.value;
          if (!val) {
            onChange(null);
            return;
          }
          const d = new Date(val);
          if (!isNaN(d.getTime())) onChange(d);
        }}
      />
      {clearable && value && (
        <button
          type="button"
          className="datetime-input-clear"
          onClick={() => {
            onChange(null);
            if (inputRef.current) inputRef.current.value = "";
          }}
          aria-label="Clear"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      )}
    </div>
  );
};

export default DateTimeInput;
