import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRealtimeChannel } from "../useRealtimeChannel";
import type { RealtimeEvent } from "../../types";

/**
 * Characterization tests for the realtime channel hook. This is the most
 * logic-dense unit in the frontend (connection lifecycle, exponential backoff,
 * foreground/visibility gating, manual sessions) and therefore the highest
 * regression risk during the React 19 migration. These tests lock in the
 * current observable behavior before any refactor.
 */

const PREF_KEY = "test:realtime-enabled";
const URL = "ws://localhost/ws";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  // Test helpers to drive the socket lifecycle.
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const latestSocket = () =>
  MockWebSocket.instances[MockWebSocket.instances.length - 1];

const createLocalStorageStub = (): Storage => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() {
      return Object.keys(store).length;
    }
  } as Storage;
};

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  Object.defineProperty(window, "localStorage", {
    value: createLocalStorageStub(),
    configurable: true,
    writable: true
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useRealtimeChannel", () => {
  it("is idle and opens no socket when neither preference nor manual session is active", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({ url: URL, preferenceKey: PREF_KEY, onEvent: vi.fn() })
    );

    expect(result.current.status).toBe("idle");
    expect(result.current.isActive).toBe(false);
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("initializes preference from localStorage", () => {
    window.localStorage.setItem(PREF_KEY, "true");

    const { result } = renderHook(() =>
      useRealtimeChannel({ url: URL, preferenceKey: PREF_KEY, onEvent: vi.fn() })
    );

    expect(result.current.isPreferenceEnabled).toBe(true);
    expect(result.current.isActive).toBe(true);
    // A socket is opened for the active channel.
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);
    expect(latestSocket().url).toBe(URL);
  });

  it("connects and reports connected status when the preference is enabled", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({ url: URL, preferenceKey: PREF_KEY, onEvent: vi.fn() })
    );

    act(() => {
      result.current.togglePreference(true);
    });

    expect(result.current.isActive).toBe(true);
    expect(result.current.status).toBe("connecting");

    act(() => {
      latestSocket().simulateOpen();
    });

    expect(result.current.status).toBe("connected");
    // Preference is persisted for next session.
    expect(window.localStorage.getItem(PREF_KEY)).toBe("true");
  });

  it("delivers parsed events to the onEvent callback", () => {
    const onEvent = vi.fn();
    const { result } = renderHook(() =>
      useRealtimeChannel({ url: URL, preferenceKey: PREF_KEY, onEvent })
    );

    act(() => {
      result.current.togglePreference(true);
    });
    act(() => {
      latestSocket().simulateOpen();
    });

    const event: RealtimeEvent = { type: "status:updated" } as RealtimeEvent;
    act(() => {
      latestSocket().simulateMessage(event);
    });

    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "status:updated" }));
  });

  it("ignores malformed messages without invoking onEvent", () => {
    const onEvent = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useRealtimeChannel({ url: URL, preferenceKey: PREF_KEY, onEvent })
    );

    act(() => {
      result.current.togglePreference(true);
    });
    act(() => {
      latestSocket().simulateOpen();
    });

    act(() => {
      latestSocket().onmessage?.({ data: "not-json{" });
    });

    expect(onEvent).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("activates via a manual session and tears down on deactivate", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({ url: URL, preferenceKey: PREF_KEY, onEvent: vi.fn() })
    );

    act(() => {
      result.current.activateManualSession();
    });
    expect(result.current.isActive).toBe(true);
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);

    const socket = latestSocket();
    act(() => {
      result.current.deactivateManualSession();
    });

    expect(result.current.isActive).toBe(false);
    expect(socket.close).toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("does not persist the preference for a manual-only session", () => {
    const { result } = renderHook(() =>
      useRealtimeChannel({ url: URL, preferenceKey: PREF_KEY, onEvent: vi.fn() })
    );

    act(() => {
      result.current.activateManualSession();
    });

    expect(window.localStorage.getItem(PREF_KEY)).toBeNull();
  });

  it("reconnects with a backoff delay after an unexpected close", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useRealtimeChannel({ url: URL, preferenceKey: PREF_KEY, onEvent: vi.fn() })
    );

    act(() => {
      result.current.togglePreference(true);
    });
    const firstSocket = latestSocket();
    act(() => {
      firstSocket.simulateOpen();
    });
    expect(MockWebSocket.instances).toHaveLength(1);

    // Server drops the connection.
    act(() => {
      firstSocket.simulateClose();
    });
    expect(result.current.status).toBe("disconnected");

    // Backoff timer elapses -> a fresh socket is created.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(MockWebSocket.instances.length).toBe(2);
  });

  it("closes the socket on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useRealtimeChannel({ url: URL, preferenceKey: PREF_KEY, onEvent: vi.fn() })
    );

    act(() => {
      result.current.togglePreference(true);
    });
    const socket = latestSocket();

    unmount();

    expect(socket.close).toHaveBeenCalled();
  });

  it("clears the persisted preference when toggled off", () => {
    window.localStorage.setItem(PREF_KEY, "true");
    const { result } = renderHook(() =>
      useRealtimeChannel({ url: URL, preferenceKey: PREF_KEY, onEvent: vi.fn() })
    );

    act(() => {
      result.current.togglePreference(false);
    });

    expect(result.current.isActive).toBe(false);
    expect(window.localStorage.getItem(PREF_KEY)).toBeNull();
  });
});
