import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient factory (Phase 3 of the React 19 migration).
 *
 * The dashboard is realtime-first: when the websocket channel is live, data is
 * pushed via `queryClient.setQueryData` / `invalidateQueries` from the realtime
 * event handler, and the per-query `refetchInterval` polling is disabled. So the
 * defaults here are deliberately conservative — no window-focus refetch storms,
 * a long stale time, and one retry.
 */
/**
 * Builds the single QueryClient the whole app shares (provided near the root via
 * `<QueryClientProvider>`). The QueryClient is TanStack Query's cache + engine:
 * it stores every query's data by key, tracks staleness, and dedupes fetches.
 *
 * The defaults below apply to *every* `useQuery` unless a hook overrides them:
 *   - staleTime 30s   — data is considered fresh for 30s, so re-mounting a
 *                       component within that window reads the cache instead of
 *                       refetching.
 *   - gcTime 5m       — how long unused (unmounted) query data lingers in cache
 *                       before garbage collection.
 *   - refetchOnWindowFocus false — no automatic refetch when the tab regains
 *                       focus; we rely on realtime pushes + explicit intervals
 *                       instead, avoiding "refetch storms."
 *   - retry 1         — retry a failed fetch once before surfacing the error.
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1
      }
    }
  });
