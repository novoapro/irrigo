import { useCallback, useState } from "react";
import { clearRainPause, confirmRain, type RainPauseStatus } from "../api";

type Intensity = "light" | "moderate" | "heavy";

const RainIcon = ({ drops }: { drops: 1 | 2 | 3 }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 17.58A5 5 0 0018 8h-1.26A8 8 0 104 16.25" />
    {drops >= 1 && <path d="M12 14l-1 3" />}
    {drops >= 2 && <><path d="M8 15l-1 3" /><path d="M16 15l-1 3" /></>}
    {drops >= 3 && <><path d="M10 18l-1 3" /><path d="M14 18l-1 3" /></>}
  </svg>
);

const STEPS: { value: Intensity; label: string; drops: 1 | 2 | 3 }[] = [
  { value: "light", label: "Light", drops: 1 },
  { value: "moderate", label: "Moderate", drops: 2 },
  { value: "heavy", label: "Heavy", drops: 3 },
];

interface RainIntensityPickerProps {
  onConfirmed?: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
  // When an active USER-set rain pause exists, a "Clear rain pause" CTA is shown.
  // Sensor-set pauses can't be cleared from here, so the CTA stays hidden for them.
  rainPause?: RainPauseStatus;
  onPauseCleared?: () => void;
}

const RainIntensityPicker = ({ onConfirmed, onDismiss, dismissLabel, rainPause, onPauseCleared }: RainIntensityPickerProps) => {
  const [intensity, setIntensity] = useState<Intensity>("moderate");
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const stepIndex = STEPS.findIndex((s) => s.value === intensity);
  // Any active pause can be removed — sensor-detected or user-confirmed alike.
  const hasActivePause = Boolean(rainPause?.active);

  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    try {
      await confirmRain(intensity);
      onConfirmed?.();
    } catch { /* ignore */ }
    setConfirming(false);
  }, [intensity, onConfirmed]);

  const handleClearPause = useCallback(async () => {
    setClearing(true);
    try {
      await clearRainPause();
      onPauseCleared?.();
    } catch { /* ignore */ }
    setClearing(false);
  }, [onPauseCleared]);

  return (
    <div className="rain-intensity-picker">
      <div className="rain-alert-slider">
        <label className="rain-alert-slider__label">How heavy was the rain?</label>
        <div className="rain-alert-slider__track-wrap">
          <input
            type="range"
            min={0}
            max={STEPS.length - 1}
            step={1}
            value={stepIndex}
            onChange={(e) => setIntensity(STEPS[Number(e.target.value)]!.value)}
            className="rain-alert-slider__input"
          />
          <div className="rain-alert-slider__labels">
            {STEPS.map((s) => (
              <button
                type="button"
                key={s.value}
                className={`rain-alert-slider__step${s.value === intensity ? " rain-alert-slider__step--active" : ""}`}
                onClick={() => setIntensity(s.value)}
              >
                <RainIcon drops={s.drops} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {confirmClear ? (
        <div className="rain-clear-confirm">
          <span className="rain-clear-confirm__q">Remove the irrigation pause?</span>
          <div className="rain-clear-confirm__actions">
            <button
              type="button"
              className="ghost-button danger-text"
              onClick={handleClearPause}
              disabled={clearing}
            >
              {clearing ? "Removing..." : "Yes, remove it"}
            </button>
            <button
              type="button"
              className="rain-alert-banner__dismiss"
              onClick={() => setConfirmClear(false)}
              disabled={clearing}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="rain-intensity-picker__actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleConfirm}
            disabled={confirming || clearing}
          >
            {confirming ? "Saving..." : "Confirm rain"}
          </button>
          {hasActivePause && (
            <button
              type="button"
              className="ghost-button danger-text"
              onClick={() => setConfirmClear(true)}
              disabled={confirming}
            >
              Remove rain pause
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              className="rain-alert-banner__dismiss"
              onClick={onDismiss}
            >
              {dismissLabel ?? "Cancel"}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default RainIntensityPicker;
