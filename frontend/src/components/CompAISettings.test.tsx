import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import type { CompAIConfig, Zone } from "../types";

/**
 * Behavioral tests for CompAISettings after its migration from
 * fetch+useState+useEffect to `useQuery(fetchCompAIConfig)`. The parent renders
 * a loading placeholder while the query is in flight, then mounts a form child
 * keyed on the loaded config so its fields initialize from server values.
 * Saving PUTs via updateCompAIConfig and then invalidates the query, which
 * re-reads the config. The api module is mocked, so nothing hits the network.
 */

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(actual)) {
    mocked[key] = typeof value === "function" ? vi.fn() : value;
  }
  return mocked;
});

import CompAISettings from "./CompAISettings";
import * as api from "../api";

const config: CompAIConfig = {
  _id: "cfg-1",
  enabled: true,
  deviceId: "DEVICE-ABC-123",
  endpoint: "https://compai.example.com",
  authType: "bearer",
  authToken: "secret-token",
  timeoutMs: 15000,
  webhookSecret: "wh-secret",
  updatedAt: "2026-01-01T00:00:00Z"
};

const zones: Zone[] = [
  {
    zoneId: "z1",
    name: "Zone 1",
    enabled: true,
    sortOrder: 0,
    defaultDurationMinutes: 10,
    maxDurationMinutes: 30
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchCompAIConfig).mockResolvedValue(config);
  vi.mocked(api.updateCompAIConfig).mockResolvedValue(config);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CompAISettings", () => {
  it("fetches the config on mount", async () => {
    renderWithProviders(<CompAISettings zones={zones} />);
    await waitFor(() => expect(api.fetchCompAIConfig).toHaveBeenCalledTimes(1));
  });

  it("shows the loading placeholder before the config resolves", () => {
    renderWithProviders(<CompAISettings zones={zones} />);
    // isLoading is true on the first synchronous render.
    expect(screen.getByText("Loading CompAI config...")).toBeInTheDocument();
  });

  it("initializes the form fields from the loaded config", async () => {
    renderWithProviders(<CompAISettings zones={zones} />);

    // Text inputs reflect server values once the query resolves.
    expect(await screen.findByDisplayValue("DEVICE-ABC-123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://compai.example.com")).toBeInTheDocument();
    expect(screen.getByDisplayValue("15000")).toBeInTheDocument();

    // Enabled toggle reflects config.enabled.
    expect(screen.getByRole("switch", { name: "Enable CompAI integration" })).toHaveAttribute(
      "aria-checked",
      "true"
    );

    // Auth-type dropdown shows the loaded selection's label.
    expect(screen.getByText("Bearer Token")).toBeInTheDocument();

    // Loading placeholder is gone.
    expect(screen.queryByText("Loading CompAI config...")).not.toBeInTheDocument();
  });

  it("saves edited values via updateCompAIConfig and re-reads the config", async () => {
    renderWithProviders(<CompAISettings zones={zones} />);

    const deviceInput = await screen.findByDisplayValue("DEVICE-ABC-123");
    await userEvent.clear(deviceInput);
    await userEvent.type(deviceInput, "NEW-DEVICE");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.updateCompAIConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          deviceId: "NEW-DEVICE",
          enabled: true,
          endpoint: "https://compai.example.com",
          authType: "bearer",
          timeoutMs: 15000
        })
      )
    );

    // Invalidating the ["compAIConfig"] query re-reads it (initial + re-fetch).
    await waitFor(() =>
      expect(vi.mocked(api.fetchCompAIConfig).mock.calls.length).toBeGreaterThanOrEqual(2)
    );
  });

  it("gracefully renders the (empty) form when the config fetch rejects", async () => {
    // The component has no dedicated error UI: on rejection useQuery leaves
    // data undefined, so the form mounts with empty/default values rather than
    // crashing. This locks in that current fallback behavior.
    vi.mocked(api.fetchCompAIConfig).mockRejectedValue(new Error("boom"));

    renderWithProviders(<CompAISettings zones={zones} />);

    // Once the (failed) query settles, loading is gone and the form is shown.
    await waitFor(() =>
      expect(screen.queryByText("Loading CompAI config...")).not.toBeInTheDocument()
    );
    expect(screen.getByRole("heading", { name: "CompAI Integration" })).toBeInTheDocument();

    // Fields fall back to empty/off (no config loaded).
    expect(screen.getByRole("switch", { name: "Enable CompAI integration" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    // authType falls back to "none", so the "Bearer Token" label is absent.
    expect(screen.queryByText("Bearer Token")).not.toBeInTheDocument();
  });
});
