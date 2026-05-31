import CompAIConfig, { type CompAIConfigAttributes } from "../models/CompAIConfig";
import Zone from "../models/Zone";
import IrrigationEvent from "../models/IrrigationEvent";
import IrrigationRecord from "../models/IrrigationRecord";
import { persistEvent } from "./irrigationEventService";
import { emitRealtimeEvent } from "./realtimeService";
import { getZoneState } from "./zoneService";
import type { CompAIWebhookPayload } from "../schemas/compAISchema";
import * as debugMock from "./debugMockService";

// ── Config cache ──

let cachedConfig: CompAIConfigAttributes | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 30_000;

export const getConfig = async (): Promise<CompAIConfigAttributes | null> => {
  if (cachedConfig && Date.now() < cacheExpiresAt) return cachedConfig;
  const doc = await CompAIConfig.findOne().lean();
  cachedConfig = doc ?? null;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedConfig;
};

export const invalidateConfigCache = () => {
  cachedConfig = null;
  cacheExpiresAt = 0;
};

export const isConfigured = async (): Promise<boolean> => {
  const config = await getConfig();
  return Boolean(config?.enabled && config.endpoint);
};

// ── HTTP helpers ──

const buildHeaders = (config: CompAIConfigAttributes): Record<string, string> => {
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

const deviceUrl = (endpoint: string, deviceId: string): string =>
  `${endpoint.replace(/\/+$/, "")}/devices/${deviceId}`;

// ── Discovery ──

export interface CompAICharacteristicInfo {
  id: string;
  name: string;
  value: unknown;
  format: string;
  permissions: string[];
  minValue?: number;
  maxValue?: number;
  units?: string;
  validValues?: Array<{ value: number; label: string }>;
}

export interface CompAIServiceInfo {
  id: string;
  name: string;
  type: string;
  characteristics: CompAICharacteristicInfo[];
}

export interface CompAIDeviceInfo {
  id: string;
  name: string;
  room?: string;
  isReachable: boolean;
  services: CompAIServiceInfo[];
}

const CHARACTERISTIC_NAME_MAP: Record<string, string> = {
  "Active": "active",
  "Set Duration": "setDuration",
  "In Use": "inUse",
  "Is Configured": "isConfigured",
  "Remaining Duration": "remainingDuration",
};

export const fetchDeviceInfo = async (): Promise<CompAIDeviceInfo> => {
  const debugConfig = await debugMock.getDebugConfig();
  if (debugConfig?.enabled) {
    return debugMock.mockFetchDeviceInfo();
  }

  const config = await getConfig();
  if (!config?.endpoint || !config.deviceId) {
    throw new Error("CompAI endpoint and deviceId must be configured");
  }

  const url = deviceUrl(config.endpoint, config.deviceId);
  const headers = buildHeaders(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Device fetch failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as CompAIDeviceInfo;
  } catch (err: any) {
    if (err?.name === "AbortError") throw new Error("Device fetch timed out");
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

export const resolveCharacteristics = (
  service: CompAIServiceInfo
): Record<string, string> => {
  const mapped: Record<string, string> = {};
  for (const char of service.characteristics) {
    const key = CHARACTERISTIC_NAME_MAP[char.name];
    if (key) mapped[key] = char.id;
  }
  return mapped;
};

// ── Outbound: send commands ──

export interface SendCommandResult {
  success: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
  url?: string;
}

const setCharacteristic = async (
  config: CompAIConfigAttributes,
  serviceId: string,
  characteristicId: string,
  value: number | boolean | string
): Promise<SendCommandResult> => {
  const url = `${deviceUrl(config.endpoint!, config.deviceId)}/control`;
  const headers = buildHeaders(config);
  const body = JSON.stringify({
    service_id: serviceId,
    characteristic_id: characteristicId,
    value
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(url, {
      method: "PUT",
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
        error: `CompAI responded with ${response.status}`,
        url
      };
    }
    return { success: true, statusCode: response.status, responseBody, url };
  } catch (err: any) {
    if (err?.name === "AbortError") return { success: false, error: "Request timed out", url };
    return { success: false, error: err?.message ?? "Unknown error", url };
  } finally {
    clearTimeout(timer);
  }
};

export const sendCommand = async (
  zoneId: string,
  action: "on" | "off",
  durationMinutes?: number
): Promise<SendCommandResult> => {
  const config = await getConfig();
  if (!config?.enabled || !config.endpoint) {
    return { success: false, error: "CompAI integration is not configured or disabled" };
  }

  const zone = await Zone.findOne({ zoneId }).lean();
  if (!zone?.compAI?.serviceId) {
    return { success: false, error: `Zone ${zoneId} has no CompAI service mapping` };
  }

  const { serviceId, characteristics } = zone.compAI;

  if (action === "on" && durationMinutes != null && durationMinutes > 0 && characteristics?.setDuration) {
    const durationResult = await setCharacteristic(
      config, serviceId, characteristics.setDuration,
      durationMinutes * 60
    );
    if (!durationResult.success) return durationResult;
  }

  const activeCharId = characteristics?.active;
  if (!activeCharId) {
    return { success: false, error: `Zone ${zoneId} has no Active characteristic ID configured` };
  }

  return setCharacteristic(config, serviceId, activeCharId, action === "on" ? 1 : 0);
};

export const testConnection = async (): Promise<{ success: boolean; message: string }> => {
  const debugConfig = await debugMock.getDebugConfig();
  if (debugConfig?.enabled) {
    return debugMock.mockTestConnection();
  }

  const config = await getConfig();
  if (!config?.endpoint || !config.deviceId) {
    return { success: false, message: "No endpoint or device ID configured" };
  }

  const url = deviceUrl(config.endpoint, config.deviceId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const headers = buildHeaders(config);
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (response.ok) {
      const data = (await response.json()) as CompAIDeviceInfo;
      return {
        success: true,
        message: `Connected — ${data.name} (${data.services.length} services, ${data.isReachable ? "reachable" : "unreachable"})`
      };
    }
    return { success: false, message: `Status ${response.status} ${response.statusText}` };
  } catch (err: any) {
    return {
      success: false,
      message: err?.name === "AbortError" ? "Connection timed out" : (err?.message ?? "Connection failed")
    };
  } finally {
    clearTimeout(timer);
  }
};

// ── Inbound: webhook processing ──

type CharacteristicName = "active" | "setDuration" | "inUse" | "isConfigured" | "remainingDuration";

export interface WebhookProcessResult {
  processed: boolean;
  reason?: string;
  zoneId?: string;
  characteristic?: CharacteristicName;
  action?: string;
}

const matchCharacteristic = (
  chars: Record<string, string | undefined> | undefined,
  characteristicId: string
): CharacteristicName | null => {
  if (!chars) return null;
  for (const [key, id] of Object.entries(chars)) {
    if (id && id === characteristicId) return key as CharacteristicName;
  }
  return null;
};

export const processWebhookPayload = async (payload: CompAIWebhookPayload): Promise<WebhookProcessResult> => {
  const config = await getConfig();
  if (!config || !config.enabled) {
    return { processed: false, reason: "integration_disabled" };
  }

  if (payload.deviceId !== config.deviceId) {
    return { processed: false, reason: "device_mismatch" };
  }

  const zone = await Zone.findOne({ "compAI.serviceId": payload.serviceId }).lean();
  if (!zone) {
    return { processed: false, reason: "unmapped_service" };
  }

  const chars = zone.compAI?.characteristics;
  const characteristic = matchCharacteristic(chars, payload.characteristicId);

  if (!characteristic) {
    return { processed: false, reason: "unrecognized_characteristic", zoneId: zone.zoneId };
  }

  await CompAIConfig.updateOne({}, { $set: { lastWebhookAt: new Date() } });
  invalidateConfigCache();

  if (characteristic === "inUse" || characteristic === "active") {
    const isOn = Boolean(payload.newValue);
    const action: "on" | "off" = isOn ? "on" : "off";

    const lastEvent = await IrrigationEvent.findOne({ zone: zone.zoneId })
      .sort({ createdAt: -1 })
      .lean();
    const alreadyInState = lastEvent?.action === action;

    if (alreadyInState) {
      return { processed: true, zoneId: zone.zoneId, characteristic, action: `already_${action}` };
    }

    await persistEvent(zone.zoneId, action);
    return { processed: true, zoneId: zone.zoneId, characteristic, action };
  }

  if (characteristic === "isConfigured") {
    const enabled = Boolean(payload.newValue);
    const updated = await Zone.findOneAndUpdate(
      { zoneId: zone.zoneId },
      { $set: { enabled, updatedAt: new Date() } },
      { new: true }
    ).lean();

    if (updated) {
      emitRealtimeEvent({ type: "zone:updated", payload: updated as any });
    }
    return { processed: true, zoneId: zone.zoneId, characteristic, action: enabled ? "enabled" : "disabled" };
  }

  if (characteristic === "setDuration") {
    const seconds = Number(payload.newValue) || 0;
    const minutes = Math.round(seconds / 60);
    return { processed: true, zoneId: zone.zoneId, characteristic, action: `${minutes}min` };
  }

  if (characteristic === "remainingDuration") {
    const seconds = Number(payload.newValue) || 0;
    const now = new Date();

    if (seconds > 0) {
      const existing = await IrrigationRecord.findOneAndUpdate(
        { zoneId: zone.zoneId, status: "running" },
        { $set: { remainingSeconds: seconds, remainingUpdatedAt: now } },
        { new: true }
      );

      if (!existing) {
        const lastEvent = await IrrigationEvent.findOne({ zone: zone.zoneId })
          .sort({ createdAt: -1 })
          .lean();

        if (lastEvent?.action !== "on") {
          await IrrigationEvent.create({
            zone: zone.zoneId,
            action: "on",
            source: "external",
            createdAt: now
          });
          await IrrigationRecord.create({
            zoneId: zone.zoneId,
            source: "manual",
            status: "running",
            startedAt: now,
            remainingSeconds: seconds,
            remainingUpdatedAt: now,
            createdAt: now
          });
        } else {
          await IrrigationRecord.create({
            zoneId: zone.zoneId,
            source: "manual",
            status: "running",
            startedAt: now,
            remainingSeconds: seconds,
            remainingUpdatedAt: now,
            createdAt: now
          });
        }
      }
    }

    const state = await getZoneState(zone.zoneId);
    emitRealtimeEvent({ type: "zoneState:changed", payload: state });

    return { processed: true, zoneId: zone.zoneId, characteristic, action: `${seconds}s remaining` };
  }

  return { processed: false, reason: "unhandled_characteristic" };
};
