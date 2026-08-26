import { useEffect, useState } from "react";

/**
 * useDebouncedValue
 * -----------------
 * Returns a *debounced* copy of `value`: a value that lags behind the input
 * and only catches up once the input has stopped changing for `delayMs`
 * milliseconds.
 *
 * ### What is "debouncing"?
 * Debouncing collapses a rapid burst of changes into a single, later update.
 * Imagine a user typing "20" into a filter box. React re-renders on every
 * keystroke ("2", then "20"), but you usually don't want to fire an expensive
 * side effect — a network request, a re-query, a heavy recompute — on each
 * intermediate character. Debouncing waits until the user pauses, then emits
 * the final value once. Every new keystroke "resets the clock", so the effect
 * only runs after a quiet gap.
 *
 * ### When to reach for this
 * - A text/number input that feeds a search or filter query — wait for the
 *   user to stop typing before hitting the API.
 * - A value that drives an expensive computation you don't want to run on
 *   every keystroke.
 * - Anything where "act on the final value after a pause" is the goal, rather
 *   than "act on every intermediate value".
 *
 * If instead you want to run *at most once per interval during* a continuous
 * stream (e.g. scroll/resize handlers), that's "throttling", a different tool.
 *
 * ### How it works
 * We keep the debounced value in state. Every time `value` (or `delayMs`)
 * changes, we start a fresh timer; if another change arrives before the timer
 * fires, the effect cleanup clears the pending timer and a new one is started.
 * Only when `delayMs` passes with no further change does the timer fire and
 * copy the latest `value` into state, triggering a re-render with the settled
 * value. The cleanup also runs on unmount, so no timer is left dangling.
 *
 * The generic `<T>` means this works for any value type — string, number,
 * object, etc. — and the returned value has the same type as the input.
 *
 * @example
 * const [text, setText] = useState("");
 * const debouncedText = useDebouncedValue(text, 400);
 * // `debouncedText` only updates 400ms after the user stops typing.
 * useEffect(() => { runSearch(debouncedText); }, [debouncedText]);
 *
 * @param value   The fast-changing value to debounce.
 * @param delayMs How long (in ms) the value must stay unchanged before the
 *                debounced copy updates.
 * @returns       The most recent `value` seen at least `delayMs` ago.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  // Seed with the initial value so the first render already has something
  // sensible (no "empty then flash to real value" on mount).
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    // Start the timer for THIS value. If `value` changes again before it
    // fires, the cleanup below clears it and this effect re-runs to start a
    // new one — that "reset the clock on every change" behaviour is the heart
    // of debouncing.
    const timer = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);

    // Cleanup runs before the next effect and on unmount, cancelling a timer
    // that never got to fire so we neither update after unmount nor emit a
    // stale intermediate value.
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debounced;
}

export default useDebouncedValue;
