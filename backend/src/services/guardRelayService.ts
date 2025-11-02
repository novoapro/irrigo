const relayEnabled = /^true$/i.test(process.env.GUARD_RELAY_ENABLED ?? "");
const relayEndpoint = process.env.GUARD_RELAY_ENDPOINT;
const relayId = process.env.GUARD_RELAY_ID;

export const isRelayConfigured = () => relayEnabled && Boolean(relayEndpoint && relayId);

export const relayGuardState = async (guard: boolean) => {
  if (!relayEnabled) {
    return;
  }

  if (!relayEndpoint || !relayId) {
    console.warn(
      "Guard relay enabled but missing GUARD_RELAY_ENDPOINT or GUARD_RELAY_ID configuration"
    );
    return;
  }

  try {
    const url = new URL(relayEndpoint);
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: relayId,
        set: "On",
        value: guard
      })
    });

    console.info("Guard relay response status:", response.status);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Guard relay failed with status ${response.status}: ${text || response.statusText}`
      );
    }
  } catch (error) {
    console.error("Guard relay request failed:", error);
  }
};
