import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MIGRATIONS = [
  { source: "aischeduleconfigs", type: "aiSchedule" },
  { source: "compaiconfigs", type: "compAI" },
  { source: "deviceconfigs", type: "device" },
  { source: "externalcontrollerconfigs", type: "externalController" },
  { source: "systemconfigs", type: "system" }
];

async function migrate() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI not set");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const configsCollection = db.collection("configs");

  console.log("Migrating config collections → configs...\n");

  for (const { source, type } of MIGRATIONS) {
    const sourceCollection = db.collection(source);
    const docs = await sourceCollection.find({}).toArray();

    if (docs.length === 0) {
      console.log(`  ${source}: no documents (skipped)`);
      continue;
    }

    const mapped = docs.map((doc) => ({ ...doc, type }));
    await configsCollection.insertMany(mapped);
    console.log(`  ${source}: migrated ${docs.length} document(s) → type: "${type}"`);
  }

  const total = await configsCollection.countDocuments();
  console.log(`\nDone. configs collection now has ${total} document(s).`);

  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
