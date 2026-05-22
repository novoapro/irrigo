import { Schema, model } from "mongoose";

export interface BaseConfigAttributes {
  type: string;
  updatedAt: Date;
}

const baseConfigSchema = new Schema<BaseConfigAttributes>(
  {
    updatedAt: { type: Date, default: () => new Date() }
  },
  {
    discriminatorKey: "type",
    collection: "configs"
  }
);

const Config = model<BaseConfigAttributes>("Config", baseConfigSchema);

export default Config;
