/**
 * useRealtimeChannel — subscribe the UI to a live WebSocket feed.
 *
 * Role in the app: opens/closes a WebSocket to the backend and forwards parsed
 * `RealtimeEvent`s to a caller-supplied `onEvent`. The dashboard controller uses
 * those events to push fresh data into the TanStack Query cache (which is why
 * polling can be disabled while this channel is active).
 *
 * Concept demonstrated — "synchronizing with an external system" (the canonical
 * `useEffect` use case). A WebSocket lives *outside* React's render model, so we
 * open it in an effect and, crucially, return a cleanup function that closes it.
 * React runs that cleanup on unmount and before re-running the effect when its
 * dependencies change.
 *
 * Several patterns worth studying here (each explained at its site below):
 *   - a ref (`onEventRef`) to always call the *latest* `onEvent` without making
 *     the connection effect depend on it;
 *   - a `disposed` flag closed over by async callbacks to ignore late events
 *     after cleanup — this also makes StrictMode's double mount/unmount safe;
 *   - reconnect backoff counters kept in refs, not state, because changing them
 *     must NOT trigger a re-render;
 *   - "gating": the socket is only open when the user enabled it (a persisted
 *     preference) or started a manual session, AND the tab is foregrounded.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import type { RealtimeEvent } from "../types";

/** Visible connection lifecycle, surfaced to the UI (e.g. a status dot). */
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

// Reconnect backoff bounds: start at 1s and double each attempt, capped at 10m.
const REALTIME_RECONNECT_DELAY_MS = 1_000;
const MAX_REALTIME_RECONNECT_DELAY_MS = 10 * 60_000;

/** Read the persisted "keep realtime on" preference from localStorage. The
 * `typeof window` guard makes this safe if ever run without a DOM (SSR/tests). */
const readPreference = (key: string) => {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(key) === "true";
};

/**
 * @param url            WebSocket URL to connect to.
 * @param preferenceKey  localStorage key persisting the user's on/off choice.
 * @param onEvent        callback invoked with each parsed realtime event.
 * @returns connection `status`, whether the channel `isActive`, the persisted
 *          preference, and controls to toggle it / run a temporary manual
 *          session / reset the reconnect backoff.
 */
export const useRealtimeChannel = ({
  url,
  preferenceKey,
  onEvent
}: UseRealtimeChannelOptions): UseRealtimeChannelResult => {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  // Lazy initializer (`() => ...`) reads localStorage only on first render, not
  // on every render.
  const [isPreferenceEnabled, setIsPreferenceEnabled] = useState(() => readPreference(preferenceKey));
  const [isManualSessionActive, setIsManualSessionActive] = useState(false);
  const [isForeground, setIsForeground] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );

  // Holds the newest `onEvent`. The socket's `onmessage` calls
  // `onEventRef.current`, so it always invokes the latest callback WITHOUT the
  // connection effect needing `onEvent` in its dependency array — otherwise a
  // new callback identity on every parent render would tear down and reopen the
  // socket. Classic "latest value" ref pattern.
  const onEventRef = useRef(onEvent);
  const previousForegroundRef = useRef(isForeground);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  // Backoff bookkeeping lives in refs, NOT state: these change during reconnect
  // scheduling and must not cause re-renders (and must be readable synchronously
  // inside the socket callbacks). attempt = exponent for the delay; maxed = we
  // reached the ceiling; halted = give up until something resets the backoff.
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

  // Keep the ref pointed at the current callback on every render.
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  // Track tab visibility so we can drop the socket in the background and reopen
  // it on return. `handleVisibilityChange()` is also called immediately to seed
  // the correct initial value.
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

  // On the background -> foreground transition, wipe any pending reconnect and
  // reset backoff so returning to the tab reconnects promptly instead of waiting
  // out a long exponential delay accumulated while hidden.
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
    // Persist the pin so the choice survives reloads (mirrors readPreference).
    if (isPreferenceEnabled) {
      window.localStorage.setItem(preferenceKey, "true");
    } else {
      window.localStorage.removeItem(preferenceKey);
    }
  }, [isPreferenceEnabled, preferenceKey]);

  // Gating: the socket should be open only when the tab is foregrounded AND
  // either the user pinned it on (persisted preference) or a temporary manual
  // session is running. `isActive` is the single derived flag the connection
  // effect below keys off of.
  const isPinned = isPreferenceEnabled && isForeground;
  const shouldMaintainManual = isManualSessionActive && isForeground;
  const isActive = isPinned || shouldMaintainManual;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!isActive) {
      // Legitimate external-system teardown: this effect owns the WebSocket
      // lifecycle, and resetting the visible connection status to "idle" as we
      // close the socket is the sanctioned "synchronize with an external
      // system" use of an effect. Behaviour is pinned by the hook's
      // characterization tests.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("idle");
      clearReconnectTimer();
      resetBackoffCounters();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      return;
    }

    // `disposed` is captured by every async socket callback below. When this
    // effect is cleaned up (unmount, or `isActive`/`url` changes) we flip it to
    // true, so any in-flight `onopen`/`onmessage`/`onclose` that fires afterward
    // bails out instead of touching a stale connection. This is what makes the
    // hook correct under React 18/19 StrictMode, which intentionally mounts,
    // unmounts, and remounts effects once in development to surface exactly this
    // kind of cleanup bug.
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
          // Parse the frame and forward it via the latest callback. The
          // `data?.type` check discards malformed frames that aren't real
          // events (see the `RealtimeEvent` discriminated union in types.ts).
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
        // If the previous delay already hit the ceiling, stop retrying: halt now
        // (one more close after the max makes further attempts pointless).
        if (reconnectMaxedRef.current) {
          reconnectHaltedRef.current = true;
          return;
        }
        // Exponential backoff: delay = base * 2^attempt, clamped to the max.
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
        // Remember whether we've reached the ceiling so the next close can halt.
        reconnectMaxedRef.current = delay === MAX_REALTIME_RECONNECT_DELAY_MS;
      };

      socket.onerror = (event) => {
        console.error("Realtime socket error:", event);
        socket.close();
      };
    };

    connect();

    // Cleanup: React runs this on unmount and before re-running the effect.
    // Flip `disposed` (neutralizing async callbacks), cancel any pending
    // reconnect, and close the socket. This is the "return a teardown" half of
    // the external-system sync pattern.
    return () => {
      disposed = true;
      clearReconnectTimer();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [isActive, url, clearReconnectTimer, resetBackoffCounters]);

  // Persisted on/off switch (the "pin"). Turning it off also ends any manual
  // session. Callbacks are memoized with `useCallback` so their identity is
  // stable across renders — important because consumers may list them in their
  // own effect deps. Toggling clears backoff so the next state takes effect now.
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

  // Start a temporary connection without changing the saved preference — used
  // for one-off flows that need live updates briefly.
  const activateManualSession = useCallback(() => {
    setIsManualSessionActive(true);
    clearReconnectTimer();
    resetBackoffCounters();
  }, [clearReconnectTimer, resetBackoffCounters]);

  const deactivateManualSession = useCallback(() => {
    setIsManualSessionActive(false);
  }, []);

  // Public escape hatch to clear a halted/maxed backoff and retry immediately.
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
