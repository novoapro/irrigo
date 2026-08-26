import { useEffect, useState } from "react";

/**
 * Returns a wall-clock timestamp (ms) that advances on an interval, so
 * components can render live-updating "elapsed" durations without calling the
 * impure `Date.now()` in render (which the React Compiler flags). The value is
 * reactive state, so anything derived from it recomputes as time passes.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
