import { Schema, model } from "mongoose";
import { randomUUID } from "node:crypto";

export interface ProgramZoneEntry {
  zoneId: string;
  durationMinutes: number;
}

export interface IrrigationProgramAttributes {
  programId: string;
  name: string;
  enabled: boolean;
  scheduleCron: string;
  zoneEntries: ProgramZoneEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const programZoneEntrySchema = new Schema<ProgramZoneEntry>(
  {
    zoneId: { type: String, required: true },
    durationMinutes: { type: Number, required: true, min: 1 }
  },
  { _id: false }
);

const irrigationProgramSchema = new Schema<IrrigationProgramAttributes>({
  programId: { type: String, required: true, unique: true, default: () => randomUUID() },
  name: { type: String, required: true, trim: true },
  enabled: { type: Boolean, default: true },
  scheduleCron: { type: String, required: true, default: "0 6 * * *" },
  zoneEntries: { type: [programZoneEntrySchema], default: [] },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() }
});

const IrrigationProgram = model<IrrigationProgramAttributes>("IrrigationProgram", irrigationProgramSchema);

export default IrrigationProgram;
