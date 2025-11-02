import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const VERBOSE_LOGGING = (process.env.VERBOSE_LOGGING ?? "").toLowerCase() === "true";
const verboseLog = (...args: unknown[]) => {
  if (VERBOSE_LOGGING) {
    console.log(...args);
  }
};

export type RealtimeEventType =
  | "connection:ready"
  | "forceHeartbeat:queued"
  | "forceHeartbeat:acknowledged"
  | "heartbeat:new"
  | "forecast:new"
  | "deviceConfig:updated"
  | "irrigation:updated"
  | "status:updated";

export interface RealtimeEvent<TPayload = unknown> {
  type: RealtimeEventType;
  payload?: TPayload;
  at?: string;
}

let websocketServer: WebSocketServer | null = null;
let keepAliveTimer: NodeJS.Timeout | null = null;

const broadcastRaw = (data: string) => {
  if (!websocketServer) {
    return;
  }

  verboseLog("[Realtime] Broadcasting payload to clients:", data);
  websocketServer.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
      } catch (error) {
        console.error("[Realtime] Failed to send message:", error);
      }
    }
  });
};

export const emitRealtimeEvent = <TPayload = unknown>(
  event: RealtimeEvent<TPayload>
) => {
  const payload: RealtimeEvent = {
    ...event,
    at: event.at ?? new Date().toISOString()
  };
  verboseLog("[Realtime] Emitting event:", payload.type, payload.at);
  broadcastRaw(JSON.stringify(payload));
};

export const startRealtimeService = (server: Server) => {
  if (websocketServer) {
    return websocketServer;
  }

  websocketServer = new WebSocketServer({
    server,
    path: "/ws"
  });

  websocketServer.on("connection", (socket) => {
    verboseLog("[Realtime] Client connected. Total clients:", websocketServer?.clients.size ?? 0);
    try {
      socket.send(
        JSON.stringify({
          type: "connection:ready",
          at: new Date().toISOString()
        } satisfies RealtimeEvent)
      );
    } catch (error) {
      console.error("[Realtime] failed to send initial handshake:", error);
    }

    socket.on("error", (error) => {
      console.error("[Realtime] client socket error:", error);
    });

    socket.on("close", () => {
      verboseLog("[Realtime] Client disconnected. Remaining clients:", websocketServer?.clients.size ?? 0);
    });
  });

  keepAliveTimer = setInterval(() => {
    if (!websocketServer) {
      return;
    }
    websocketServer.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        verboseLog("[Realtime] Sending keep-alive ping to client");
        client.ping();
      }
    });
  }, 30000);

  console.log("[Realtime] WebSocket server listening on /ws");
  return websocketServer;
};

export const stopRealtimeService = () => {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  if (websocketServer) {
    verboseLog("[Realtime] Shutting down WebSocket server. Closing", websocketServer.clients.size, "clients");
    websocketServer.clients.forEach((client) => {
      try {
        client.terminate();
      } catch (error) {
        console.error("[Realtime] failed to terminate client:", error);
      }
    });
    websocketServer.close();
    websocketServer = null;
  }
};
