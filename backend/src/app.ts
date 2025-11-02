import express from "express";
import cors from "cors";
import routes from "./routes";
import requestLogger from "./middleware/requestLogger";

const app = express();

app.use(cors());
app.use(express.json());

// Conditionally enable verbose request logging via environment variable
const VERBOSE = (() => {
  const v = (process.env.VERBOSE_LOGGING ?? process.env.VERBOSE ?? "").toString();
  return v === "1" || v.toLowerCase() === "true";
})();
if (VERBOSE) {
  console.log("Verbose request logging enabled");
  app.use(requestLogger);
}

app.use("/api", routes);

app.get("/", (_req, res) => {
  res.json({ message: "My Lawn Monitor API" });
});

app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

export default app;
