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
