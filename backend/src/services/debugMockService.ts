import DebugConfig, { type DebugConfigAttributes } from "../models/configs/DebugConfig";
import type { SendCommandResult } from "./compAIService";

let cachedConfig: DebugConfigAttributes | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 30_000;

export const getDebugConfig = async (): Promise<DebugConfigAttributes | null> => {
  if (cachedConfig && Date.now() < cacheExpiresAt) return cachedConfig;
  const doc = await DebugConfig.findOne().lean();
  cachedConfig = doc ?? null;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cachedConfig;
};

export const invalidateDebugCache = () => {
  cachedConfig = null;
  cacheExpiresAt = 0;
};

export const isDebugMode = async (): Promise<boolean> => {
  const config = await getDebugConfig();
  return Boolean(config?.enabled);
};

export const mockSendCommand = async (
  _zoneId: string,
  _action: "on" | "off",
  _durationMinutes?: number
): Promise<SendCommandResult> => ({
  success: true,
  statusCode: 200,
  responseBody: '{"ok":true}',
  url: "debug://mock/compai/control"
});

export const mockFetchDeviceInfo = async () => ({
  id: "DEBUG-DEVICE-001",
  name: "Debug Irrigation Controller",
  room: "Garden",
  isReachable: true,
  services: []
});

export const mockTestConnection = async (): Promise<{ success: boolean; message: string }> => ({
  success: true,
  message: "Debug mode — simulated connection OK"
});
