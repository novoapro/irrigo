import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchCompAIConfig,
  testCompAIConnection,
  fetchAIScheduleConfig
} from "../api";

export type HealthState = "ok" | "warning" | "error" | "off" | "loading" | "unknown";

interface HealthSignal {
  state: HealthState;
  label: string;
}

export interface IntegrationHealth {
  server: HealthSignal;
  controller: HealthSignal;
  ai: HealthSignal;
  weather: HealthSignal;
}

const HEALTH_CHECK_INTERVAL_MS = 60_000;
const INTEGRATION_HEALTH_KEY = ["integrationHealth"] as const;
const LOADING: HealthSignal = { state: "loading", label: "Checking..." };

const computeControllerHealth = async (): Promise<HealthSignal> => {
  try {
    const config = await fetchCompAIConfig();
    if (!config || !config.endpoint || !config.deviceId) {
      return { state: "off", label: "Not configured" };
    }
    if (!config.enabled) {
      return { state: "off", label: "Disabled" };
    }
    try {
      const result = await testCompAIConnection();
      return result.success
        ? { state: "ok", label: "Connected" }
        : { state: "error", label: "Unreachable" };
    } catch {
      return { state: "error", label: "Unreachable" };
    }
  } catch {
    return { state: "unknown", label: "Unknown" };
  }
};

const computeAiHealth = async (): Promise<HealthSignal> => {
  try {
    const config = await fetchAIScheduleConfig();
    if (!config || !config.apiKey) {
      return { state: "off", label: "Not configured" };
    }
    if (!config.enabled) {
      return { state: "off", label: "Disabled" };
    }
    if (config.lastRunStatus === "error") {
      return { state: "warning", label: "Last run failed" };
    }
    return { state: "ok", label: "Active" };
  } catch {
    return { state: "unknown", label: "Unknown" };
  }
};

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
}): IntegrationHealth & { recheckController: () => void } => {
  const queryClient = useQueryClient();

  // Periodic health poll for the external integrations. Replaces the manual
  // setInterval + setState loop (which tripped set-state-in-effect); the
  // controller and AI checks are independent, so they run together per tick.
  const healthQuery = useQuery({
    queryKey: INTEGRATION_HEALTH_KEY,
    queryFn: async () => {
      const [controller, ai] = await Promise.all([
        computeControllerHealth(),
        computeAiHealth()
      ]);
      return { controller, ai };
    },
    refetchInterval: HEALTH_CHECK_INTERVAL_MS,
    refetchOnWindowFocus: true
  });

  const controllerState = healthQuery.data?.controller ?? LOADING;
  const aiState = healthQuery.data?.ai ?? LOADING;

  const serverState: HealthSignal = (() => {
    if (!isRealtimeActive) {
      return { state: "off", label: "Live off" };
    }
    switch (realtimeStatus) {
      case "connected":
        return { state: "ok", label: "Connected" };
      case "connecting":
        return { state: "warning", label: "Connecting" };
      case "disconnected":
        return { state: "error", label: "Disconnected" };
      default:
        return { state: "unknown", label: "Idle" };
    }
  })();

  const weatherState: HealthSignal = (() => {
    if (forecastError) {
      return { state: "error", label: "Error" };
    }
    if (!hasForecast) {
      return { state: "warning", label: "Loading" };
    }
    return { state: "ok", label: "Active" };
  })();

  const recheckController = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: INTEGRATION_HEALTH_KEY });
  }, [queryClient]);

  return {
    server: serverState,
    controller: controllerState,
    ai: aiState,
    weather: weatherState,
    recheckController
  };
};
