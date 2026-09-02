import { Request, Response } from "express";
import { Types } from "mongoose";
import Heartbeat, { HeartbeatAttributes } from "../models/Heartbeat";
import IrrigationEvent from "../models/IrrigationEvent";
import StatusSnapshot from "../models/StatusSnapshot";

export interface ResolvedStatusPayload {
  guard: HeartbeatAttributes["guard"];
  ready: boolean;
  lastUpdatedAt: string | null;
  sensors: HeartbeatAttributes["sensors"];
  device: HeartbeatAttributes["device"];
  irrigation: {
    active: boolean;
    zone: string | null;
    action: "on" | "off" | null;
  };
  changes: {
    guard: string | null;
    sensors: {
      waterPsi: string | null;
      rain: string | null;
      soil: string | null;
    };
    irrigation: string | null;
  };
}

interface CachedStatus {
  heartbeatId?: string | null;
  irrigationId?: string | null;
  payload: ResolvedStatusPayload | null;
}

export const statusCache: CachedStatus = {
  heartbeatId: null,
  irrigationId: null,
  payload: null
};

export const snapshotStatus = async (
  payload: ResolvedStatusPayload,
  heartbeatId?: string | null,
  irrigationId?: string | null
) => {
  try {
    await StatusSnapshot.create({
      createdAt: new Date(),
      heartbeatId: heartbeatId ? new Types.ObjectId(heartbeatId) : null,
      irrigationId: irrigationId ? new Types.ObjectId(irrigationId) : null,
      payload
    });
  } catch (snapshotError) {
    console.error("Failed to persist status snapshot:", snapshotError);
  }
};

const buildStatusPayload = async () => {
  const [latestHeartbeat, latestIrrigation] = await Promise.all([
    Heartbeat.findOne().sort({ timestamp: -1 }).lean(),
    IrrigationEvent.findOne().sort({ createdAt: -1 }).lean()
  ]);

  if (!latestHeartbeat) {
    throw new Error("No heartbeat data found");
  }

  const latestHeartbeatId = latestHeartbeat._id ? latestHeartbeat._id.toString() : null;
  const latestIrrigationId = latestIrrigation?._id ? latestIrrigation._id.toString() : null;

  const irrigationStatus = latestIrrigation
    ? {
        active: latestIrrigation.action === "on",
        zone: latestIrrigation.zone,
        action: latestIrrigation.action
      }
    : {
        active: false,
        zone: null,
        action: null
      };

  const toIso = (value: Date | string | undefined | null) => {
    if (!value) return null;
    const ts = value instanceof Date ? value : new Date(value);
    return Number.isNaN(ts.getTime()) ? null : ts.toISOString();
  };

  const heartbeatChanges = calculateChangeMetadata(latestHeartbeat);
  const irrigationChangeIso = toIso(latestIrrigation?.createdAt);

  const changeCandidates = [
    heartbeatChanges.guard,
    heartbeatChanges.sensors.waterPsi,
    heartbeatChanges.sensors.rain,
    heartbeatChanges.sensors.soil,
    irrigationChangeIso,
    toIso(latestHeartbeat.timestamp)
  ]
    .map((value) => (value ? Date.parse(value) : Number.NEGATIVE_INFINITY))
    .filter((value) => Number.isFinite(value));

  const latestChangeIso =
    changeCandidates.length > 0
      ? new Date(Math.max(...changeCandidates)).toISOString()
      : toIso(latestHeartbeat.timestamp);

  return {
    payload: {
      guard: latestHeartbeat.guard,
      ready: !latestHeartbeat.guard.triggered,
      lastUpdatedAt: latestChangeIso,
      sensors: latestHeartbeat.sensors,
      device: latestHeartbeat.device,
      irrigation: irrigationStatus,
      changes: {
        ...heartbeatChanges,
        irrigation: irrigationChangeIso
      }
    } satisfies ResolvedStatusPayload,
    latestHeartbeatId,
    latestIrrigationId
  };
};

export const refreshStatusCache = async () => {
  const { payload, latestHeartbeatId, latestIrrigationId } = await buildStatusPayload();
  statusCache.heartbeatId = latestHeartbeatId;
  statusCache.irrigationId = latestIrrigationId;
  statusCache.payload = payload;
  await snapshotStatus(payload, latestHeartbeatId, latestIrrigationId);
  return payload;
};

export const getSystemStatus = async (_req: Request, res: Response) => {
  try {
    const [latestHeartbeat, latestIrrigation] = await Promise.all([
      Heartbeat.findOne().sort({ timestamp: -1 }).lean(),
      IrrigationEvent.findOne().sort({ createdAt: -1 }).lean()
    ]);

    if (!latestHeartbeat) {
      console.warn("[API] getSystemStatus - no heartbeat data available", {
        method: _req.method,
        url: _req.originalUrl
      });
      return res.status(404).json({ message: "No heartbeat data found" });
    }

    const latestHeartbeatId = latestHeartbeat._id ? latestHeartbeat._id.toString() : null;
    const latestIrrigationId = latestIrrigation?._id ? latestIrrigation._id.toString() : null;

    if (
      statusCache.payload &&
      statusCache.heartbeatId === latestHeartbeatId &&
      statusCache.irrigationId === latestIrrigationId
    ) {
      return res.json(statusCache.payload);
    }

    const payload = await refreshStatusCache();
    res.json(payload);
  } catch (error) {
    console.error("Failed to compute system status:", error);
    res.status(500).json({ message: "Unable to fetch system status" });
  }
};

export const listStatusSnapshots = async (req: Request, res: Response) => {
  const pageCandidate = Number.parseInt((req.query.page as string) ?? "", 10);
  const page = Number.isInteger(pageCandidate) && pageCandidate > 0 ? pageCandidate : 1;

  const pageSizeCandidate = Number.parseInt((req.query.pageSize as string) ?? "", 10);
  const pageSize =
    Number.isInteger(pageSizeCandidate) && pageSizeCandidate > 0
      ? Math.min(pageSizeCandidate, 200)
      : 50;

  const skip = (page - 1) * pageSize;

  try {
    const [totalCount, snapshots] = await Promise.all([
      StatusSnapshot.countDocuments(),
      StatusSnapshot.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
    ]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    res.json({
      data: snapshots,
      meta: {
        page,
        pageSize,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1
      }
    });
  } catch (error) {
    console.error("Failed to list status snapshots:", error);
    res.status(500).json({ message: "Unable to fetch status history" });
  }
};

// Each tracked reading now carries its own `since` (set at ingest — see
// heartbeatController), so "when did this last change?" is a direct read off the latest
// heartbeat rather than a scan back through hundreds of records.
const calculateChangeMetadata = (latest: HeartbeatAttributes) => {
  const toIso = (value: Date | string | null | undefined) => {
    if (!value) return null;
    const ts = value instanceof Date ? value : new Date(value);
    return Number.isNaN(ts.getTime()) ? null : ts.toISOString();
  };

  return {
    guard: toIso(latest.guard.since),
    sensors: {
      waterPsi: toIso(latest.sensors.waterPsi.since),
      rain: toIso(latest.sensors.rain.since),
      soil: toIso(latest.sensors.soil.since)
    }
  };
};
