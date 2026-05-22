import IrrigationCommand from "../models/IrrigationCommand";
import type { CommandSource } from "../models/IrrigationCommand";
import Zone from "../models/Zone";
import Heartbeat from "../models/Heartbeat";
import IrrigationEvent from "../models/IrrigationEvent";
import { emitRealtimeEvent } from "./realtimeService";
import * as externalController from "./externalControllerService";
import * as compAI from "./compAIService";

const COMMAND_TIMEOUT_MS = 60_000;
const autoOffTimers = new Map<string, NodeJS.Timeout>();

const serializeCommand = (doc: Record<string, unknown>) => {
  const { __v, ...rest } = doc;
  return rest;
};

export const createCommand = async (
  zoneId: string,
  action: "on" | "off",
  durationMinutes?: number,
  source: CommandSource = "manual"
) => {
  const zone = await Zone.findOne({ zoneId }).lean();
  if (!zone) throw new Error("Zone not found");
  if (!zone.enabled) throw new Error("Zone is disabled");

  if (action === "on" && source !== "manual") {
    const latestHeartbeat = await Heartbeat.findOne().sort({ timestamp: -1 }).lean();
    if (latestHeartbeat?.guard) {
      throw new Error("Guard is active — irrigation not permitted");
    }
  }

  if (action === "on") {
    const lastEvent = await IrrigationEvent.findOne({ zone: zoneId })
      .sort({ createdAt: -1 })
      .lean();
    if (lastEvent?.action === "on") {
      throw new Error("Zone is already on");
    }
  }

  if (action === "on" && durationMinutes != null) {
    const max = zone.maxDurationMinutes ?? 60;
    if (durationMinutes > max) {
      throw new Error(`Duration exceeds max of ${max} minutes`);
    }
  }

  const command = await IrrigationCommand.create({
    zoneId,
    action,
    durationMinutes: action === "on" ? (durationMinutes ?? null) : null,
    source,
    status: "pending",
    createdAt: new Date()
  });

  emitRealtimeEvent({ type: "command:created", payload: serializeCommand(command.toObject()) });

  const compAIConfigured = await compAI.isConfigured();
  const controllerMethod = compAIConfigured ? "compai" : "external";
  const result = compAIConfigured
    ? await compAI.sendCommand(zoneId, action, durationMinutes)
    : await externalController.sendCommand(zoneId, action, durationMinutes);

  command.controllerMethod = controllerMethod;
  command.controllerUrl = result.url ?? null;
  command.controllerResponseStatus = result.statusCode ?? null;
  command.controllerResponseBody = result.responseBody?.slice(0, 2048) ?? null;

  if (result.success) {
    command.status = "sent";
    command.sentAt = new Date();
    await command.save();

    emitRealtimeEvent({ type: "command:updated", payload: serializeCommand(command.toObject()) });

    if (action === "on" && durationMinutes != null && durationMinutes > 0) {
      scheduleAutoOff(zoneId, durationMinutes);
    }

    scheduleTimeout(command._id.toString());
  } else {
    command.status = "failed";
    command.errorMessage = result.error ?? "Unknown error";
    await command.save();

    emitRealtimeEvent({ type: "command:updated", payload: serializeCommand(command.toObject()) });
  }

  return serializeCommand(command.toObject());
};

const scheduleAutoOff = (zoneId: string, durationMinutes: number) => {
  const existing = autoOffTimers.get(zoneId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    autoOffTimers.delete(zoneId);
    try {
      const lastEvent = await IrrigationEvent.findOne({ zone: zoneId })
        .sort({ createdAt: -1 })
        .lean();
      if (lastEvent?.action === "on") {
        await createCommand(zoneId, "off", undefined, "manual");
      }
    } catch (err) {
      console.error(`Auto-off failed for zone ${zoneId}:`, err);
    }
  }, durationMinutes * 60_000);

  autoOffTimers.set(zoneId, timer);
};

const scheduleTimeout = (commandId: string) => {
  setTimeout(async () => {
    try {
      const cmd = await IrrigationCommand.findById(commandId);
      if (cmd && cmd.status === "sent") {
        cmd.status = "timeout";
        await cmd.save();
        emitRealtimeEvent({ type: "command:updated", payload: serializeCommand(cmd.toObject()) });
      }
    } catch (err) {
      console.error(`Timeout check failed for command ${commandId}:`, err);
    }
  }, COMMAND_TIMEOUT_MS);
};

export const acknowledgeCommand = async (zoneId: string, action: "on" | "off") => {
  const cmd = await IrrigationCommand.findOne({
    zoneId,
    action,
    status: { $in: ["pending", "sent"] }
  })
    .sort({ createdAt: -1 })
    .exec();

  if (!cmd) return null;

  cmd.status = "acknowledged";
  cmd.acknowledgedAt = new Date();
  await cmd.save();

  emitRealtimeEvent({ type: "command:updated", payload: serializeCommand(cmd.toObject()) });

  const zoneState = {
    zoneId,
    isActive: action === "on",
    lastAction: action,
    lastEventAt: new Date().toISOString(),
    activeCommandId: action === "on" ? cmd._id.toString() : null,
    activeDurationMinutes: action === "on" ? (cmd.durationMinutes ?? null) : null
  };
  emitRealtimeEvent({ type: "zoneState:changed", payload: zoneState });

  return cmd;
};

export interface CommandListQuery {
  zoneId?: string;
  status?: string;
  source?: string;
  action?: string;
  start?: string;
  end?: string;
  page?: number;
  pageSize?: number;
}

const buildCommandFilter = (query: Omit<CommandListQuery, "page" | "pageSize">) => {
  const filter: Record<string, unknown> = {};
  if (query.zoneId) filter.zoneId = query.zoneId;
  if (query.status) filter.status = query.status;
  if (query.source) filter.source = query.source;
  if (query.action) filter.action = query.action;
  if (query.start || query.end) {
    const dateFilter: Record<string, Date> = {};
    if (query.start) dateFilter.$gte = new Date(query.start);
    if (query.end) dateFilter.$lte = new Date(query.end);
    filter.createdAt = dateFilter;
  }
  return filter;
};

export const listCommands = async (query: CommandListQuery) => {
  const filter = buildCommandFilter(query);

  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = Math.min(query.pageSize ?? 50, 500);
  const skip = (page - 1) * pageSize;

  const [totalCount, commands] = await Promise.all([
    IrrigationCommand.countDocuments(filter),
    IrrigationCommand.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean()
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    commands: commands.map(serializeCommand),
    meta: {
      page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1
    }
  };
};

export const deleteCommands = async (query: Omit<CommandListQuery, "page" | "pageSize">) => {
  const filter = buildCommandFilter(query);
  const result = await IrrigationCommand.deleteMany(filter);
  return { deletedCount: result.deletedCount ?? 0 };
};

export const getCommand = async (commandId: string) => {
  const cmd = await IrrigationCommand.findById(commandId).lean();
  return cmd ? serializeCommand(cmd) : null;
};

export const clearAutoOffTimers = () => {
  autoOffTimers.forEach((timer) => clearTimeout(timer));
  autoOffTimers.clear();
};
