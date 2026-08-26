import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ThemeProvider } from "./ThemeContext";
import { createQueryClient } from "./lib/queryClient";
import "./styles.css";

// One QueryClient for the whole app — it holds the server-state cache that every
// useQuery/useMutation reads and writes.
const queryClient = createQueryClient();

// Provider nesting (outer → inner): the Query cache and the theme are app-wide
// context; the router sits closest to <App> so route hooks work inside it.
// <StrictMode> intentionally double-invokes effects in dev to surface unsafe
// ones — the effects here are written to tolerate it (see useRealtimeChannel).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
