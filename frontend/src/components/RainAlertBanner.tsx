import { useEffect, useState } from "react";
import { fetchRainAlert, type RainAlert } from "../api";
import RainIntensityPicker from "./RainIntensityPicker";

const RainAlertBanner = ({ refreshKey, onConfirmed }: { refreshKey?: number; onConfirmed?: () => void }) => {
  const [alert, setAlert] = useState<RainAlert | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDismissed(false);
    fetchRainAlert()
      .then((data) => { if (!cancelled) setAlert(data); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (!alert?.alert || dismissed) return null;

  const periodLabel = alert.periodStart
    ? new Date(alert.periodStart).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    : "";

  return (
    <div className="rain-alert-banner">
      <div className="rain-alert-banner__header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 17.58A5 5 0 0018 8h-1.26A8 8 0 104 16.25" /><path d="M8 16l-2 4M12 13l-2 4M16 16l-2 4" /></svg>
        <p>Rain was forecast ({alert.probability}%{periodLabel ? `, ${periodLabel}` : ""}) but sensors didn't detect it.</p>
      </div>

      <RainIntensityPicker
        onConfirmed={() => { setAlert((a) => a ? { ...a, alert: false } : a); onConfirmed?.(); }}
        onDismiss={() => setDismissed(true)}
        dismissLabel="No, it didn't rain"
      />
    </div>
  );
};

export default RainAlertBanner;
