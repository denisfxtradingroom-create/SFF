import assert from "node:assert/strict";
import { cloudflareTurnConfigured, createIceResolver } from "../backend/turn-ice.mjs";

const cloudflareEnv = {
  SFF_TURN_KEY_ID: "test-key-id",
  SFF_TURN_API_TOKEN: "server-private-token",
};
assert.equal(cloudflareTurnConfigured({}), false);
assert.equal(cloudflareTurnConfigured(cloudflareEnv), true);

const empty = createIceResolver({ env: {} });
assert.deepEqual(await empty(false), { ice: [], mode: "default" },
  "Community voice channels must retain existing no-ICE default");
assert.deepEqual(await empty(true), {
  ice: [{ urls: "stun:stun.l.google.com:19302" }],
  mode: "stun_only",
}, "Private calls fall back to STUN when TURN is not configured");

const specified = [{ urls:"turns:relay.example.com:5349?transport=tcp",
  username:"test-user", credential:"test-password" }];
const configured = createIceResolver({
  env: { SFF_ICE: JSON.stringify(specified) },
  request: () => { throw Error("No remote TURN requests for existing static settings"); },
});
assert.deepEqual((await configured(false)).ice,specified);
assert.deepEqual((await configured(true)).ice,specified);

const issued = [
  { urls:["stun:stun.cloudflare.com:3478"] },
  { urls:["turn:turn.cloudflare.com:3478?transport=udp",
    "turns:turn.cloudflare.com:443?transport=tcp"],
    username:"short-lived-user",credential:"short-lived-secret" },
];
let calls = 0, time = 10_000, capturedUrl = null;
const resolver = createIceResolver({
  env: cloudflareEnv, now:()=>time,
  request: async (url,opts) => {
    calls++;
    capturedUrl=url;
    assert.equal(opts.method,"POST");
    assert.equal(opts.headers.Authorization,"Bearer server-private-token");
    assert.equal(JSON.parse(opts.body).ttl,3600);
    return { ok:true, json:async()=>({iceServers:issued}) };
  },
});
const voice = await resolver(false);
assert.equal(voice.mode,"default");
assert.equal(calls,0,"Community voice must not use chargeable TURN API");
const first = await resolver(true);
assert.equal(first.mode,"turn");
assert.equal(first.ice.length,2);
assert(capturedUrl.endsWith("/test-key-id/credentials/generate-ice-servers"));
assert.equal(first.ice[1].username,"short-lived-user");
assert.equal(first.ice[1].credential,"short-lived-secret");
assert(!JSON.stringify(first).includes(cloudflareEnv.SFF_TURN_API_TOKEN),
  "Never send Cloudflare server API secret in WebSocket ICE response");
await resolver(true);
assert.equal(calls,1,"Two clients joining within one minute share cached credentials");
time+=61_000;
await resolver(true);
assert.equal(calls,2,"Expired cached credentials must refresh");

let warnings=[];
const fallback = createIceResolver({
  env:cloudflareEnv,
  warn:(msg)=>warnings.push(msg),
  request:async()=>({ok:false,status:401}),
});
const result = await fallback(true);
assert.equal(result.mode,"stun_only");
assert.deepEqual(result.ice,[{urls:"stun:stun.l.google.com:19302"}]);
assert(warnings[0].includes("401"));
assert(!warnings.join("").includes(cloudflareEnv.SFF_TURN_API_TOKEN));
const malformed = createIceResolver({
  env:cloudflareEnv,
  warn:(msg)=>warnings.push(msg),
  request:async()=>({ok:true,json:async()=>({iceServers:[{urls:"stun:stun.cloudflare.com:3478"}]})}),
});
assert.equal((await malformed(true)).mode,"stun_only",
  "Never claim TURN configured when provider returns only STUN");

console.log("SFF TURN: opt-in Cloudflare ephemeral credentials, safe fallback, no secret leakage, caching, voice channels unchanged PASS");
