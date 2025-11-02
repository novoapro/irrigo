import { Schema, model, Types } from "mongoose";

export interface StatusSnapshotAttributes {
  createdAt: Date;
  heartbeatId?: Types.ObjectId | null;
  irrigationId?: Types.ObjectId | null;
  payload: unknown;
}

const statusSnapshotSchema = new Schema<StatusSnapshotAttributes>({
  createdAt: { type: Date, default: () => new Date(), index: true },
  heartbeatId: { type: Schema.Types.ObjectId, default: null },
  irrigationId: { type: Schema.Types.ObjectId, default: null },
  payload: { type: Schema.Types.Mixed, required: true }
});

const StatusSnapshot = model<StatusSnapshotAttributes>("StatusSnapshot", statusSnapshotSchema);

export default StatusSnapshot;
