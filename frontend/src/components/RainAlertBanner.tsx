import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dismissRainAlert, fetchRainAlert } from "../api";
import RainIntensityPicker from "./RainIntensityPicker";

const RainAlertBanner = ({ refreshKey, onConfirmed }: { refreshKey?: number; onConfirmed?: () => void }) => {
  const { data: alert } = useQuery({
    queryKey: ["rainAlert", refreshKey],
    queryFn: async () => (await fetchRainAlert()) ?? null
  });
  // Track which refreshKey the banner was handled for (confirmed or dismissed),
  // so a fresh alert (new refreshKey) shows again without a synchronous reset
  // effect. Wrapped in an object so an unset value never collides with an
  // undefined refreshKey.
  const [handled, setHandled] = useState<{ key?: number } | null>(null);
  const dismissed = handled !== null && handled.key === refreshKey;

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
        onConfirmed={() => { setHandled({ key: refreshKey }); onConfirmed?.(); }}
        onDismiss={() => {
          // Hide immediately; persist the response so the alert stays answered
          // (server-side) until the next calendar day, across re-mounts and reloads.
          setHandled({ key: refreshKey });
          dismissRainAlert().catch(() => {});
        }}
        dismissLabel="No, it didn't rain"
      />
    </div>
  );
};

export default RainAlertBanner;
