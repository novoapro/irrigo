import { Request, Response } from "express";
import type { CreateCommandInput } from "../schemas/irrigationCommandSchema";
import * as commandService from "../services/irrigationCommandService";

export const sendCommand = async (req: Request, res: Response) => {
  const payload = req.validatedBody as CreateCommandInput | undefined;
  if (!payload) {
    return res.status(400).json({ message: "Invalid command payload" });
  }

  const { zoneId } = req.params;

  try {
    const command = await commandService.createCommand(
      zoneId,
      payload.action,
      payload.durationMinutes,
      "manual"
    );
    res.status(201).json({ data: command });
  } catch (err: any) {
    const message = err?.message ?? "Command failed";
    const status = message.includes("not found") ? 404
      : message.includes("disabled") ? 400
      : message.includes("already on") ? 409
      : message.includes("exceeds max") ? 400
      : 500;
    res.status(status).json({ message });
  }
};

export const listCommands = async (req: Request, res: Response) => {
  try {
    const result = await commandService.listCommands({
      zoneId: req.query.zoneId as string | undefined,
      status: req.query.status as string | undefined,
      page: Number(req.query.page) || undefined,
      pageSize: Number(req.query.pageSize) || undefined
    });
    res.json(result);
  } catch (err) {
    console.error("Failed to list commands:", err);
    res.status(500).json({ message: "Unable to fetch commands" });
  }
};

export const getCommand = async (req: Request, res: Response) => {
  try {
    const command = await commandService.getCommand(req.params.commandId);
    if (!command) {
      return res.status(404).json({ message: "Command not found" });
    }
    res.json({ data: command });
  } catch (err) {
    console.error("Failed to get command:", err);
    res.status(500).json({ message: "Unable to fetch command" });
  }
};
