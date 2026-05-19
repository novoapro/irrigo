import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchExternalControllerConfig,
  testExternalController,
  fetchAIScheduleConfig
} from "../api";

export type HealthState = "ok" | "warning" | "error" | "off" | "loading" | "unknown";

export interface IntegrationHealth {
  server: { state: HealthState; label: string };
  controller: { state: HealthState; label: string };
  ai: { state: HealthState; label: string };
  weather: { state: HealthState; label: string };
}

const HEALTH_CHECK_INTERVAL_MS = 60_000;

export const useIntegrationHealth = ({
  realtimeStatus,
  isRealtimeActive,
  forecastError,
  hasForecast
}: {
  realtimeStatus: string;
  isRealtimeActive: boolean;
  forecastError: string | null;
  hasForecast: boolean;
}): IntegrationHealth => {
  const [controllerState, setControllerState] = useState<{ state: HealthState; label: string }>({
    state: "loading",
    label: "Checking..."
  });
  const [aiState, setAiState] = useState<{ state: HealthState; label: string }>({
    state: "loading",
    label: "Checking..."
  });

  const mountedRef = useRef(true);

  const checkHealth = useCallback(async () => {
    try {
      const config = await fetchExternalControllerConfig();
      if (!mountedRef.current) return;
      if (!config || !config.endpoint) {
        setControllerState({ state: "off", label: "Not configured" });
      } else if (!config.enabled) {
        setControllerState({ state: "off", label: "Disabled" });
      } else {
        try {
          const result = await testExternalController();
          if (!mountedRef.current) return;
          setControllerState(
            result.success
              ? { state: "ok", label: "Connected" }
              : { state: "error", label: "Unreachable" }
          );
        } catch {
          if (mountedRef.current) {
            setControllerState({ state: "error", label: "Unreachable" });
          }
        }
      }
    } catch {
      if (mountedRef.current) {
        setControllerState({ state: "unknown", label: "Unknown" });
      }
    }

    try {
      const config = await fetchAIScheduleConfig();
      if (!mountedRef.current) return;
      if (!config || !config.apiKey) {
        setAiState({ state: "off", label: "Not configured" });
      } else if (!config.enabled) {
        setAiState({ state: "off", label: "Disabled" });
      } else if (config.lastRunStatus === "error") {
        setAiState({ state: "warning", label: "Last run failed" });
      } else {
        setAiState({ state: "ok", label: "Active" });
      }
    } catch {
      if (mountedRef.current) {
        setAiState({ state: "unknown", label: "Unknown" });
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    checkHealth();
    const interval = window.setInterval(checkHealth, HEALTH_CHECK_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [checkHealth]);

  const serverState = (() => {
    if (!isRealtimeActive) {
      return { state: "off" as const, label: "Live off" };
    }
    switch (realtimeStatus) {
      case "connected":
        return { state: "ok" as const, label: "Connected" };
      case "connecting":
        return { state: "warning" as const, label: "Connecting" };
      case "disconnected":
        return { state: "error" as const, label: "Disconnected" };
      default:
        return { state: "unknown" as const, label: "Idle" };
    }
  })();

  const weatherState = (() => {
    if (forecastError) {
      return { state: "error" as const, label: "Error" };
    }
    if (!hasForecast) {
      return { state: "warning" as const, label: "Loading" };
    }
    return { state: "ok" as const, label: "Active" };
  })();

  return {
    server: serverState,
    controller: controllerState,
    ai: aiState,
    weather: weatherState
  };
};
