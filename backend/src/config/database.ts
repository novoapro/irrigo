import mongoose from "mongoose";

const connectToDatabase = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error("Missing MONGO_URI environment variable");
  }

  // Startup diagnostic: surface exactly which host we're about to dial, so a
  // stray exported MONGO_URI or the wrong .env file is obvious at a glance.
  try {
    console.log(`Connecting to MongoDB host: ${new URL(uri).host}`);
  } catch {
    console.log("Connecting to MongoDB (unparseable MONGO_URI)");
  }

  if (mongoose.connection.readyState === mongoose.ConnectionStates.connected) {
    return mongoose.connection;
  }

  try {
    await mongoose.connect(uri);
    mongoose.connection.on("connected", () => {
      console.log("Connected to MongoDB");
    });

    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err);
    });

    return mongoose.connection;
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    throw error;
  }
};

export default connectToDatabase;
