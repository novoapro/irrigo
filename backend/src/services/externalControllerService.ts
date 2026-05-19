import ExternalControllerConfig from "../models/ExternalControllerConfig";
import type { ExternalControllerConfigAttributes } from "../models/ExternalControllerConfig";

let cachedConfig: ExternalControllerConfigAttributes | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000;

const loadConfig = async (): Promise<ExternalControllerConfigAttributes | null> => {
  if (cachedConfig && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedConfig;
  }
  const doc = await ExternalControllerConfig.findOne().sort({ updatedAt: -1 }).lean();
  cachedConfig = doc ?? null;
  cachedAt = Date.now();
  return cachedConfig;
};

export const invalidateCache = () => {
  cachedConfig = null;
  cachedAt = 0;
};

export const isConfigured = async (): Promise<boolean> => {
  const config = await loadConfig();
  return Boolean(config?.enabled && config.endpoint);
};

export const getConfig = async () => loadConfig();

const buildHeaders = (config: ExternalControllerConfigAttributes): Record<string, string> => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.authType === "bearer" && config.authToken) {
    headers["Authorization"] = `Bearer ${config.authToken}`;
  } else if (config.authType === "apikey" && config.authToken) {
    headers["X-API-Key"] = config.authToken;
  } else if (config.authType === "basic" && config.authToken) {
    headers["Authorization"] = `Basic ${config.authToken}`;
  }
  return headers;
};

const interpolatePath = (
  template: string,
  vars: Record<string, string>
): string => {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{{${key}}}`).join(encodeURIComponent(value));
  }
  return result;
};

export interface SendCommandResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
}

export const sendCommand = async (
  zoneId: string,
  action: "on" | "off",
  durationMinutes?: number
): Promise<SendCommandResult> => {
  const config = await loadConfig();
  if (!config?.enabled || !config.endpoint) {
    return { success: false, error: "External controller is not configured or disabled" };
  }

  const externalZoneId = config.zoneMapping?.[zoneId] ?? zoneId;
  const actionValue = action === "on" ? "1" : "0";

  let url: string;
  if (config.commandPath) {
    const path = interpolatePath(config.commandPath, {
      zoneId: externalZoneId,
      action: actionValue,
      duration: durationMinutes?.toString() ?? "0"
    });
    url = new URL(path, config.endpoint).toString();
  } else {
    url = config.endpoint;
  }

  const headers = buildHeaders(config);
  const body = JSON.stringify({
    zone: externalZoneId,
    action,
    duration: durationMinutes ?? null
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });

    const responseBody = await response.text();
    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        responseBody,
        error: `External controller responded with ${response.status}`
      };
    }

    return { success: true, statusCode: response.status, responseBody };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { success: false, error: "Request timed out" };
    }
    return { success: false, error: err?.message ?? "Unknown error" };
  } finally {
    clearTimeout(timeout);
  }
};

export const testConnection = async (): Promise<{ success: boolean; message: string }> => {
  const config = await loadConfig();
  if (!config?.endpoint) {
    return { success: false, message: "No endpoint configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const headers = buildHeaders(config);
    const response = await fetch(config.endpoint, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    return {
      success: response.ok,
      message: `Status ${response.status} ${response.statusText}`
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.name === "AbortError" ? "Connection timed out" : (err?.message ?? "Connection failed")
    };
  } finally {
    clearTimeout(timeout);
  }
};
