// Optional Cloudflare Realtime TURN credentials for private SFF calls.
// The Cloudflare TURN API token stays on Render; only temporary ICE credentials
// are sent to authenticated participants. No Turso queries or background polling.
const DEFAULT_DM_STUN = Object.freeze([{ urls: "stun:stun.l.google.com:19302" }]);
const URL_PROTOCOL = /^(stun:|stuns:|turn:|turns:)/i;

export const cloudflareTurnConfigured = (env = process.env) =>
  Boolean(env.SFF_TURN_KEY_ID?.trim() && env.SFF_TURN_API_TOKEN?.trim());

function validateIceServers(value, requireTurn = false) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16)
    throw Error("Neispravan TURN odgovor (ICE lista).");
  let turnFound = false;
  const result = value.map((server) => {
    const urls = typeof server?.urls === "string"
      ? [server.urls] : server?.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 16 ||
        urls.some((url) => typeof url !== "string" || url.length > 256 ||
          !URL_PROTOCOL.test(url))) {
      throw Error("Neispravne ICE adrese.");
    }
    const isTurn = urls.some((url) => /^turns?:/i.test(url));
    if (isTurn) {
      turnFound = true;
      if (typeof server.username !== "string" || !server.username ||
          typeof server.credential !== "string" || !server.credential)
        throw Error("Nedostaju TURN podaci.");
    }
    return {
      urls: urls.length === 1 ? urls[0] : urls,
      ...(isTurn ? { username: server.username, credential: server.credential } : {}),
    };
  });
  if (requireTurn && !turnFound)
    throw Error("TURN server nije vraćen u odgovoru.");
  return result;
}

export function createIceResolver({
  env = process.env,
  request = globalThis.fetch,
  now = Date.now,
  warn = (message) => console.warn("[SFF TURN] " + message),
} = {}) {
  let cached = null;
  let cacheExpires = 0;
  let inFlight = null;

  function staticIce() {
    const source = JSON.parse(env.SFF_ICE || "[]");
    return source.length ? validateIceServers(source) : [];
  }

  async function cloudflareIce() {
    if (cached && now() < cacheExpires) return cached;
    if (inFlight) return inFlight;
    const keyId = String(env.SFF_TURN_KEY_ID).trim();
    const token = String(env.SFF_TURN_API_TOKEN).trim();
    inFlight = (async () => {
      const url = "https://rtc.live.cloudflare.com/v1/turn/keys/" +
        encodeURIComponent(keyId) + "/credentials/generate-ice-servers";
      const response = await request(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 3600 }),
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok)
        throw Error("Cloudflare TURN HTTP " + response.status);
      const json = await response.json();
      const result = validateIceServers(json.iceServers, true);
      // A brief cache allows two call participants to reuse a credential,
      // while still rotating short-lived credentials regularly.
      cached = result;
      cacheExpires = now() + 60_000;
      return result;
    })();
    try { return await inFlight; }
    finally { inFlight = null; }
  }

  return async function resolveIce(isPrivateCall = false) {
    // Preserve all existing voice-channel ICE settings.
    if (!isPrivateCall) {
      const configured = staticIce();
      return { ice: configured, mode: configured.length ? "configured" : "default" };
    }

    if (cloudflareTurnConfigured(env)) {
      try {
        return { ice: await cloudflareIce(), mode: "turn" };
      } catch (error) {
        // Never print a bearer token, response body or temporary credentials.
        warn(error?.name === "TimeoutError" ? "TURN API timeout" :
          /Cloudflare TURN HTTP/.test(error?.message || "") ? error.message :
          "TURN API trenutno nije dostupna");
      }
    }
    const configured = staticIce();
    if (configured.length)
      return { ice: configured, mode: "configured" };
    return { ice: [...DEFAULT_DM_STUN], mode: "stun_only" };
  };
}
