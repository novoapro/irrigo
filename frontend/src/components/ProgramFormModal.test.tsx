import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test/renderWithProviders";
import type { IrrigationProgram, Zone } from "../types";

/**
 * Behavioral tests for the keyed open-wrapper/body split of ProgramFormModal.
 *
 * The body is mounted only while `open` and keyed by the target program, so form
 * state (name, enabled, cron -> frequency/time/days, per-zone entries)
 * initialises from props at mount with no prop-sync effect. These lock in
 * initialisation for edit vs add, the zones-derived entry list, the keyed
 * re-init on program switch, and the create payload.
 */

vi.mock("../api", () => ({
  createProgram: vi.fn().mockResolvedValue({}),
  updateProgram: vi.fn().mockResolvedValue({})
}));

import { createProgram } from "../api";
import ProgramFormModal from "./ProgramFormModal";

const makeZone = (overrides: Partial<Zone> = {}): Zone => ({
  zoneId: "alpha",
  name: "Alpha",
  enabled: true,
  sortOrder: 0,
  defaultDurationMinutes: 15,
  maxDurationMinutes: 60,
  ...overrides
});

const ZONES: Zone[] = [
  makeZone({ zoneId: "alpha", name: "Alpha", enabled: true, defaultDurationMinutes: 15 }),
  makeZone({ zoneId: "bravo", name: "Bravo", enabled: false, defaultDurationMinutes: 20 })
];

const makeProgram = (overrides: Partial<IrrigationProgram> = {}): IrrigationProgram => ({
  programId: "prog-1",
  name: "Evening",
  enabled: false,
  source: "manual",
  scheduleCron: "30 7 * * 1,3,5",
  zoneEntries: [{ zoneId: "alpha", durationMinutes: 25 }],
  ...overrides
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProgramFormModal", () => {
  it("renders nothing when closed", () => {
    renderWithProviders(
      <ProgramFormModal
        open={false}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        zones={ZONES}
        program={makeProgram()}
      />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit Program")).not.toBeInTheDocument();
  });

  it("initialises from an existing program (name, enabled, parsed cron, zone entries)", () => {
    renderWithProviders(
      <ProgramFormModal
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        zones={ZONES}
        program={makeProgram()}
      />
    );

    expect(screen.getByRole("heading", { name: "Edit Program" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Evening")).toBeInTheDocument();
    // enabled=false on the program.
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    // Cron "30 7 * * 1,3,5" -> Weekdays, 07:30, Mon/Wed/Fri.
    expect(screen.getByText("Weekdays")).toBeInTheDocument();
    expect(screen.getByDisplayValue("07:30")).toBeInTheDocument();
    for (const day of ["Mon", "Wed", "Fri"]) {
      expect(screen.getByRole("button", { name: day }).className).toContain(
        "weekday-picker__day--active"
      );
    }
    expect(screen.getByRole("button", { name: "Tue" }).className).not.toContain(
      "weekday-picker__day--active"
    );
    // Zone entries: alpha included at its program duration, bravo excluded.
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bravo" })).not.toBeChecked();
    expect(screen.getByDisplayValue("25")).toBeInTheDocument();
  });

  it("shows defaults and zones-derived entries when opened without a program", () => {
    renderWithProviders(
      <ProgramFormModal
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
        zones={ZONES}
      />
    );

    expect(screen.getByRole("heading", { name: "New Program" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Summer Evening")).toHaveValue("");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    // Defaults: daily @ 06:00.
    expect(screen.getByText("Every day")).toBeInTheDocument();
    expect(screen.getByDisplayValue("06:00")).toBeInTheDocument();
    // Both zones listed; included follows zone.enabled.
    expect(screen.getByRole("checkbox", { name: "Alpha" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bravo" })).not.toBeChecked();
    // Included zone shows its default duration.
    expect(screen.getByDisplayValue("15")).toBeInTheDocument();
  });

  it("creates a program with the built payload on submit", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderWithProviders(
      <ProgramFormModal
        open
        onClose={vi.fn()}
        onSaved={onSaved}
        zones={ZONES}
      />
    );

    await user.type(screen.getByPlaceholderText("e.g. Summer Evening"), "My Program");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(createProgram).toHaveBeenCalledTimes(1));
    expect(createProgram).toHaveBeenCalledWith({
      name: "My Program",
      enabled: true,
      source: "manual",
      scheduleCron: "0 6 * * *",
      zoneEntries: [{ zoneId: "alpha", durationMinutes: 15 }]
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("re-initialises from the new program when the edited program switches (keyed remount)", () => {
    const shared = { onClose: vi.fn(), onSaved: vi.fn(), zones: ZONES };
    const { rerender } = renderWithProviders(
      <ProgramFormModal open program={makeProgram()} {...shared} />
    );
    expect(screen.getByDisplayValue("Evening")).toBeInTheDocument();

    rerender(
      <ProgramFormModal
        open
        program={makeProgram({ programId: "prog-2", name: "Morning", enabled: true })}
        {...shared}
      />
    );
    expect(screen.getByDisplayValue("Morning")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Evening")).not.toBeInTheDocument();
  });
});
