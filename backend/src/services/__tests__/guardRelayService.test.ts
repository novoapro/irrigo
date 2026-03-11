/**
 * guardRelayService reads process.env at module load time, so each describe
 * block calls jest.resetModules() + re-imports the module with the desired
 * env variables set to get an isolated copy of the constants.
 */

// Store original env vars so we can restore them after each test
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  // Restore env and clear the module registry so the next test gets a fresh import
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.assign(process.env, ORIGINAL_ENV);
  jest.resetModules();
});

// Helper: re-import the module with specific env vars already set.
// process.env coerces values to strings, so keys that should be absent must be
// explicitly deleted — assigning undefined would produce the string "undefined".
const loadModule = async (env: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const mod = await import("../guardRelayService");
  return mod;
};

describe("isRelayConfigured", () => {
  it("returns false when GUARD_RELAY_ENABLED is not set", async () => {
    const { isRelayConfigured } = await loadModule({
      GUARD_RELAY_ENABLED: undefined,
      GUARD_RELAY_ENDPOINT: undefined,
      GUARD_RELAY_ID: undefined
    });
    expect(isRelayConfigured()).toBe(false);
  });

  it("returns false when GUARD_RELAY_ENABLED is 'false'", async () => {
    const { isRelayConfigured } = await loadModule({
      GUARD_RELAY_ENABLED: "false",
      GUARD_RELAY_ENDPOINT: "http://relay.example.com",
      GUARD_RELAY_ID: "relay-1"
    });
    expect(isRelayConfigured()).toBe(false);
  });

  it("returns false when relay is enabled but endpoint is missing", async () => {
    const { isRelayConfigured } = await loadModule({
      GUARD_RELAY_ENABLED: "true",
      GUARD_RELAY_ENDPOINT: undefined,
      GUARD_RELAY_ID: "relay-1"
    });
    expect(isRelayConfigured()).toBe(false);
  });

  it("returns false when relay is enabled but relay ID is missing", async () => {
    const { isRelayConfigured } = await loadModule({
      GUARD_RELAY_ENABLED: "true",
      GUARD_RELAY_ENDPOINT: "http://relay.example.com",
      GUARD_RELAY_ID: undefined
    });
    expect(isRelayConfigured()).toBe(false);
  });

  it("returns true when relay is enabled with both endpoint and ID present", async () => {
    const { isRelayConfigured } = await loadModule({
      GUARD_RELAY_ENABLED: "true",
      GUARD_RELAY_ENDPOINT: "http://relay.example.com/api",
      GUARD_RELAY_ID: "relay-1"
    });
    expect(isRelayConfigured()).toBe(true);
  });

  it("accepts 'TRUE' (case-insensitive match)", async () => {
    const { isRelayConfigured } = await loadModule({
      GUARD_RELAY_ENABLED: "TRUE",
      GUARD_RELAY_ENDPOINT: "http://relay.example.com/api",
      GUARD_RELAY_ID: "relay-1"
    });
    expect(isRelayConfigured()).toBe(true);
  });

  it("accepts 'True' (mixed case)", async () => {
    const { isRelayConfigured } = await loadModule({
      GUARD_RELAY_ENABLED: "True",
      GUARD_RELAY_ENDPOINT: "http://relay.example.com/api",
      GUARD_RELAY_ID: "relay-1"
    });
    expect(isRelayConfigured()).toBe(true);
  });
});
