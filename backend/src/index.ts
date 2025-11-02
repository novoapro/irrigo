import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import http from "node:http";
import app from "./app";
import connectToDatabase from "./config/database";
import {
  ensureForecastSnapshot,
  startForecastAutoRefresh,
  scheduleForecastPeriodPush
} from "./services/weatherForecastService";
import { startRealtimeService } from "./services/realtimeService";

const loadEnvironment = () => {
  const env =
    process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  const candidates = [
    `.env.${env}.local`,
    `.env.${env}`,
    ".env.local",
    ".env"
  ];
  const cwd = process.cwd();

  candidates.forEach((filename) => {
    const filepath = path.resolve(cwd, filename);
    if (fs.existsSync(filepath)) {
      dotenv.config({ path: filepath });
    }
  });
};

loadEnvironment();

const PORT = Number(process.env.PORT ?? 4000);

const start = async () => {
  try {
    await connectToDatabase();
    await ensureForecastSnapshot();
    await scheduleForecastPeriodPush();
    startForecastAutoRefresh();

    const server = http.createServer(app);
    startRealtimeService(server);

    server.listen(PORT, () => {
      console.log(`API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

void start();
