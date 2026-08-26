import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import ZoneFormModal from "./ZoneFormModal";
import type { Zone } from "../types";

/**
 * Behavioral tests for the keyed open-wrapper/body split of ZoneFormModal.
 *
 * The form no longer syncs props into state via an effect: the body is mounted
 * only while `open` and is keyed by the target zone, so state initialises
 * straight from props at mount. These tests lock that in: initialisation from an
 * existing zone, add-mode defaults + derived Zone ID slug, keyed re-init when the
 * edited zone changes, and the onSave payload.
 */

const makeZone = (overrides: Partial<Zone> = {}): Zone => ({
  zoneId: "backyard",
  name: "Backyard",
  description: "North strip",
  enabled: false,
  sortOrder: 0,
  defaultDurationMinutes: 20,
  maxDurationMinutes: 45,
  metadata: {
    plantType: "grass",
    sunExposure: "full",
    soilType: "clay",
    area: 250,
    notes: "shady corner"
  },
  ...overrides
});

const zoneIdText = () =>
  document.querySelector(".zone-form-id__value")?.textContent ?? "";

describe("ZoneFormModal", () => {
  it("renders nothing when closed", () => {
    renderWithProviders(
      <ZoneFormModal
        open={false}
        zone={makeZone()}
        existingZones={[]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit Zone")).not.toBeInTheDocument();
  });

  it("initialises fields from an existing zone when opened", () => {
    renderWithProviders(
      <ZoneFormModal
        open
        zone={makeZone()}
        existingZones={[makeZone()]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Edit Zone" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Backyard")).toBeInTheDocument();
    expect(screen.getByDisplayValue("North strip")).toBeInTheDocument();
    // Durations, area.
    expect(screen.getByDisplayValue("20")).toBeInTheDocument();
    expect(screen.getByDisplayValue("45")).toBeInTheDocument();
    expect(screen.getByDisplayValue("250")).toBeInTheDocument();
    expect(screen.getByDisplayValue("shady corner")).toBeInTheDocument();
    // Enabled toggle reflects the (disabled) zone.
    expect(screen.getByRole("switch", { name: "Enable zone" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    // Zone ID comes straight from the zone when editing.
    expect(zoneIdText()).toBe("backyard");
    // Metadata dropdowns show their mapped labels.
    expect(screen.getByText("Grass / Turf")).toBeInTheDocument();
    expect(screen.getByText("Full Sun")).toBeInTheDocument();
    expect(screen.getByText("Clay")).toBeInTheDocument();
  });

  it("shows defaults in add mode and derives the Zone ID slug from the typed name", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ZoneFormModal
        open
        zone={null}
        existingZones={[makeZone({ zoneId: "front-lawn", name: "Front Lawn" })]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Add Zone" })).toBeInTheDocument();
    // Default durations.
    expect(screen.getByDisplayValue("15")).toBeInTheDocument();
    expect(screen.getByDisplayValue("60")).toBeInTheDocument();
    // No name yet -> no Zone ID.
    expect(zoneIdText()).toBe("—");

    const nameInput = screen.getByPlaceholderText("Front Lawn");
    await user.type(nameInput, "Side Garden");
    expect(zoneIdText()).toBe("side-garden");

    // Collides with the existing "front-lawn" id -> uniqueness suffix.
    await user.clear(nameInput);
    await user.type(nameInput, "Front Lawn");
    expect(zoneIdText()).toBe("front-lawn-2");
  });

  it("re-initialises from the new zone when the edited zone switches (keyed remount)", async () => {
    const user = userEvent.setup();
    const shared = {
      existingZones: [],
      onSave: vi.fn().mockResolvedValue(undefined),
      onClose: vi.fn()
    };
    const { rerender } = renderWithProviders(
      <ZoneFormModal
        open
        zone={makeZone({ zoneId: "alpha", name: "Alpha" })}
        {...shared}
      />
    );
    expect(screen.getByDisplayValue("Alpha")).toBeInTheDocument();

    // Edit the name in-place; a keyed remount must discard this.
    await user.type(screen.getByDisplayValue("Alpha"), " EDITED");
    expect(screen.getByDisplayValue("Alpha EDITED")).toBeInTheDocument();

    rerender(
      <ZoneFormModal
        open
        zone={makeZone({ zoneId: "bravo", name: "Bravo" })}
        {...shared}
      />
    );

    expect(screen.getByDisplayValue("Bravo")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Alpha EDITED")).not.toBeInTheDocument();
    expect(zoneIdText()).toBe("bravo");
  });

  it("calls onSave with the built payload on submit", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <ZoneFormModal
        open
        zone={null}
        existingZones={[]}
        onSave={onSave}
        onClose={vi.fn()}
      />
    );

    await user.type(screen.getByPlaceholderText("Front Lawn"), "Herb Bed");
    await user.click(screen.getByRole("button", { name: "Create zone" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        zoneId: "herb-bed",
        name: "Herb Bed",
        defaultDurationMinutes: 15,
        maxDurationMinutes: 60,
        enabled: true
      })
    );
  });
});
