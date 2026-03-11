import "@testing-library/jest-dom";

// Pin the timezone to UTC so date formatting tests produce the same output
// regardless of the machine running them.
process.env.TZ = "UTC";
