import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import type { RealtimeEvent } from "../types";

export type RealtimeStatus = "idle" | "connecting" | "connected" | "disconnected";

interface UseRealtimeChannelOptions {
  url: string;
  preferenceKey: string;
  onEvent: (event: RealtimeEvent) => void;
}

interface UseRealtimeChannelResult {
  status: RealtimeStatus;
  isActive: boolean;
  isPreferenceEnabled: boolean;
  togglePreference: (enabled: boolean) => void;
  activateManualSession: () => void;
  deactivateManualSession: () => void;
  resetBackoff: () => void;
}

const REALTIME_RECONNECT_DELAY_MS = 1_000;
const MAX_REALTIME_RECONNECT_DELAY_MS = 10 * 60_000;

const readPreference = (key: string) => {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(key) === "true";
};

export const useRealtimeChannel = ({
  url,
  preferenceKey,
  onEvent
}: UseRealtimeChannelOptions): UseRealtimeChannelResult => {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [isPreferenceEnabled, setIsPreferenceEnabled] = useState(() => readPreference(preferenceKey));
  const [isManualSessionActive, setIsManualSessionActive] = useState(false);
  const [isForeground, setIsForeground] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );

  const onEventRef = useRef(onEvent);
  const previousForegroundRef = useRef(isForeground);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectMaxedRef = useRef(false);
  const reconnectHaltedRef = useRef(false);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const resetBackoffCounters = useCallback(() => {
    reconnectAttemptRef.current = 0;
    reconnectMaxedRef.current = false;
    reconnectHaltedRef.current = false;
  }, []);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const handleVisibilityChange = () => {
      setIsForeground(document.visibilityState !== "hidden");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const wasForeground = previousForegroundRef.current;
    if (!wasForeground && isForeground) {
      clearReconnectTimer();
      resetBackoffCounters();
    }
    previousForegroundRef.current = isForeground;
  }, [isForeground, clearReconnectTimer, resetBackoffCounters]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (isPreferenceEnabled) {
      window.localStorage.setItem(preferenceKey, "true");
    } else {
      window.localStorage.removeItem(preferenceKey);
    }
  }, [isPreferenceEnabled, preferenceKey]);

  const isPinned = isPreferenceEnabled && isForeground;
  const shouldMaintainManual = isManualSessionActive && isForeground;
  const isActive = isPinned || shouldMaintainManual;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!isActive) {
      setStatus("idle");
      clearReconnectTimer();
      resetBackoffCounters();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      return;
    }

    let disposed = false;

    const connect = () => {
      if (disposed || !isActive || reconnectHaltedRef.current) {
        return;
      }
      setStatus("connecting");
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) {
          return;
        }
        resetBackoffCounters();
        setStatus("connected");
      };

      socket.onmessage = (event) => {
        if (disposed) {
          return;
        }
        try {
          const data = JSON.parse(event.data) as RealtimeEvent;
          if (data?.type) {
            onEventRef.current(data);
          }
        } catch (error) {
          console.error("Failed to parse realtime event:", error);
        }
      };

      socket.onclose = () => {
        if (disposed || !isActive) {
          return;
        }
        setStatus("disconnected");
        if (reconnectHaltedRef.current) {
          return;
        }
        if (reconnectMaxedRef.current) {
          reconnectHaltedRef.current = true;
          return;
        }
        const attempt = reconnectAttemptRef.current;
        const delay = Math.min(
          REALTIME_RECONNECT_DELAY_MS * Math.pow(2, attempt),
          MAX_REALTIME_RECONNECT_DELAY_MS
        );
        clearReconnectTimer();
        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, delay);
        reconnectAttemptRef.current = attempt + 1;
        reconnectMaxedRef.current = delay === MAX_REALTIME_RECONNECT_DELAY_MS;
      };

      socket.onerror = (event) => {
        console.error("Realtime socket error:", event);
        socket.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [isActive, url, clearReconnectTimer, resetBackoffCounters]);

  const togglePreference = useCallback(
    (enabled: boolean) => {
      if (!enabled) {
        setIsManualSessionActive(false);
      }
      clearReconnectTimer();
      resetBackoffCounters();
      setIsPreferenceEnabled(enabled);
    },
    [clearReconnectTimer, resetBackoffCounters]
  );

  const activateManualSession = useCallback(() => {
    setIsManualSessionActive(true);
    clearReconnectTimer();
    resetBackoffCounters();
  }, [clearReconnectTimer, resetBackoffCounters]);

  const deactivateManualSession = useCallback(() => {
    setIsManualSessionActive(false);
  }, []);

  const resetBackoff = useCallback(() => {
    clearReconnectTimer();
    resetBackoffCounters();
  }, [clearReconnectTimer, resetBackoffCounters]);

  return {
    status,
    isActive,
    isPreferenceEnabled,
    togglePreference,
    activateManualSession,
    deactivateManualSession,
    resetBackoff
  };
};
