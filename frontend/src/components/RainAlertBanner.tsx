import { useCallback, useEffect, useState } from "react";
import { fetchRainAlert, confirmRain, type RainAlert } from "../api";

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

const RainAlertBanner = ({ refreshKey }: { refreshKey?: number }) => {
  const [alert, setAlert] = useState<RainAlert | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [intensity, setIntensity] = useState<Intensity>("moderate");

  useEffect(() => {
    let cancelled = false;
    setDismissed(false);
    fetchRainAlert()
      .then((data) => { if (!cancelled) setAlert(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey]);

  const handleConfirm = useCallback(async () => {
    setConfirming(true);
    try {
      await confirmRain(intensity);
      setAlert((a) => a ? { ...a, alert: false } : a);
    } catch { /* ignore */ }
    setConfirming(false);
  }, [intensity]);

  if (!alert?.alert || dismissed) return null;

  const periodLabel = alert.periodStart
    ? new Date(alert.periodStart).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    : "";

  const stepIndex = STEPS.findIndex((s) => s.value === intensity);

  return (
    <div className="rain-alert-banner">
      <div className="rain-alert-banner__header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 17.58A5 5 0 0018 8h-1.26A8 8 0 104 16.25" /><path d="M8 16l-2 4M12 13l-2 4M16 16l-2 4" /></svg>
        <p>Rain was forecast ({alert.probability}%{periodLabel ? `, ${periodLabel}` : ""}) but sensors didn't detect it.</p>
      </div>

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

      <div className="rain-alert-banner__footer">
        <button
          type="button"
          className="primary-button"
          onClick={handleConfirm}
          disabled={confirming}
        >
          {confirming ? "Saving..." : "Yes, it rained"}
        </button>
        <button
          type="button"
          className="rain-alert-banner__dismiss"
          onClick={() => setDismissed(true)}
        >
          No, it didn't rain
        </button>
      </div>
    </div>
  );
};

export default RainAlertBanner;
