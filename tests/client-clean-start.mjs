import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../client/index.html", import.meta.url), "utf8");
assert(html.includes('<script src="/clean-start.js"></script>'));
assert(html.indexOf("/clean-start.js") < html.indexOf("/social-notifications.js"));
assert(html.indexOf("/clean-start.js") < html.indexOf("/app.js"));

const script = readFileSync(new URL("../client/clean-start.js", import.meta.url), "utf8");
const state = new Map([
  ["sff.social.history.v2.1:prvi", "[1,2]"],
  ["sff.social.lastRead.v2.1:prvi", "99"],
  ["sff.social.quiet", "true"],
  ["unrelated-app-preference", "keep"],
]);
const localStorage = {
  get length() { return state.size; },
  key(index) { return [...state.keys()][index] ?? null; },
  getItem(key) { return state.has(key) ? state.get(key) : null; },
  setItem(key, value) { state.set(key, String(value)); },
  removeItem(key) { state.delete(key); },
};
runInNewContext(script, { localStorage });
assert.equal(state.get("sff.social.history.v2.1:prvi"), undefined);
assert.equal(state.get("sff.social.lastRead.v2.1:prvi"), undefined);
assert.equal(state.get("sff.social.quiet"), undefined);
assert.equal(state.get("unrelated-app-preference"), "keep");
assert(state.get("sff.clean-start.applied"));

state.set("sff.social.quiet", "false");
runInNewContext(script, { localStorage });
assert.equal(state.get("sff.social.quiet"), "false",
  "Do not delete newly configured settings on subsequent app launches.");
console.log("SFF clean start: old local notification state cleared once per device.");
