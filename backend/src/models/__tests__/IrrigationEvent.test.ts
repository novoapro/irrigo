/**
 * Root-cause regression guard.
 *
 * A webhook-confirmed irrigation event copies the acknowledged command's source, so
 * IrrigationEvent.source MUST accept every IrrigationCommand source. When "program"
 * and "ai-schedule" were missing, persistEvent threw on create for scheduled/AI runs —
 * silently breaking their event/record tracking and run advancement, while manual runs
 * (source "manual") kept working. These checks run with validateSync (no DB needed).
 */
import IrrigationEvent from "../IrrigationEvent";
import { CommandSource } from "../IrrigationCommand";

describe("IrrigationEvent.source enum", () => {
  // Mirrors the IrrigationCommand.source union; if a new command source is added, this
  // array should fail to type-check until the event enum is widened too.
  const commandSources: CommandSource[] = ["manual", "schedule", "program", "ai-schedule"];

  it.each(commandSources)("accepts command source %s (no validation error on source)", (source) => {
    const err = new IrrigationEvent({ zone: "z1", action: "on", source }).validateSync();
    expect(err?.errors?.source).toBeUndefined();
  });

  it("accepts external and null (events with no owning command)", () => {
    expect(new IrrigationEvent({ zone: "z1", action: "on", source: "external" }).validateSync()?.errors?.source).toBeUndefined();
    expect(new IrrigationEvent({ zone: "z1", action: "on", source: null }).validateSync()?.errors?.source).toBeUndefined();
  });

  it("still rejects an unknown source", () => {
    const err = new IrrigationEvent({ zone: "z1", action: "on", source: "bogus" as any }).validateSync();
    expect(err?.errors?.source).toBeDefined();
  });
});
