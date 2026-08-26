import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Test helper: render a component tree inside the providers App relies on — a
 * fresh isolated QueryClient (retries/refetch off, no shared cache leakage
 * between tests) and a MemoryRouter. Added in Phase 3 when the data layer moved
 * to TanStack Query.
 */
export const makeTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: Infinity },
      mutations: { retry: false }
    }
  });

export const renderWithProviders = (
  ui: ReactElement,
  options?: {
    queryClient?: QueryClient;
    routerProps?: { initialEntries?: string[] };
    renderOptions?: Omit<RenderOptions, "wrapper">;
  }
) => {
  const queryClient = options?.queryClient ?? makeTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter {...options?.routerProps}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...options?.renderOptions })
  };
};
