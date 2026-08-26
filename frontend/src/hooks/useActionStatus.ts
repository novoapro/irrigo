/**
 * useActionStatus — tracks the loading / success / error lifecycle of an async
 * action so a button (or any control) can show transient feedback.
 *
 * Call `wrap(fn)` with the async work; the hook flips `status` to "loading",
 * then to "success" or "error", and finally back to "idle" after
 * `feedbackDuration` ms. An optional `onFeedbackComplete` fires shortly after
 * the reset (see FEEDBACK_PAUSE).
 *
 * WHY ITS OWN FILE: this hook used to live in ActionButton.tsx. Vite's React
 * Fast Refresh can only hot-swap a module that exports *components only* — a
 * non-component export (like a hook) forces a full page reload on every edit.
 * Keeping the hook here lets ActionButton.tsx stay a components-only module.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionStatus } from "../components/ActionButton";

// Small gap between resetting to "idle" and firing `onFeedbackComplete`, so the
// idle UI has a beat to render before the completion callback (e.g. a close)
// runs. ActionButton keeps its own copy for its internal timers.
const FEEDBACK_PAUSE = 300;

export function useActionStatus(feedbackDuration = 2000, onFeedbackComplete?: () => void) {
  const [status, setStatus] = useState<ActionStatus>("idle");
  const timeoutRef = useRef<number>(undefined);
  const mountedRef = useRef(true);
  const onFeedbackCompleteRef = useRef(onFeedbackComplete);
  // Keep the latest callback in a ref without writing during render (compiler
  // `refs` rule); a no-dep effect runs after every commit.
  useEffect(() => {
    onFeedbackCompleteRef.current = onFeedbackComplete;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimeout(timeoutRef.current);
    };
  }, []);

  const wrap = useCallback(async (fn: () => Promise<void>) => {
    setStatus("loading");
    try {
      await fn();
      if (!mountedRef.current) return;
      setStatus("success");
      clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setStatus("idle");
        if (onFeedbackCompleteRef.current) {
          window.setTimeout(() => {
            if (mountedRef.current) onFeedbackCompleteRef.current?.();
          }, FEEDBACK_PAUSE);
        }
      }, feedbackDuration);
    } catch (e) {
      if (!mountedRef.current) return;
      setStatus("error");
      clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        setStatus("idle");
        if (onFeedbackCompleteRef.current) {
          window.setTimeout(() => {
            if (mountedRef.current) onFeedbackCompleteRef.current?.();
          }, FEEDBACK_PAUSE);
        }
      }, feedbackDuration);
      throw e;
    }
  }, [feedbackDuration]);

  return { status, wrap } as const;
}
