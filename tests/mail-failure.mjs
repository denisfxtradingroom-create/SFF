import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "sff-mail-error-"));
const entry = fileURLToPath(new URL("../backend/server.mjs", import.meta.url));
const server = spawn(process.execPath,
  ["--import", new URL("./mail-transport.mjs", import.meta.url).href, entry],
  { env: {
      ...process.env, SFF_DATA: dir, PORT: "0", HOST: "127.0.0.1",
      RESEND_API_KEY: "test", SFF_MAIL_FROM: "test@example.test",
      SFF_REQUIRE_VERIFIED_EMAIL: "1",
      SFF_TEST_MAIL_FAIL: "1", SFF_TEST_OUTBOX: join(dir, "outbox.json"),
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);

try {
  const [output] = await once(server.stdout, "data");
  const origin = "http://127.0.0.1:" + output.toString().trim().split(" ").at(-1);
  const user = { cookie: "" };
  async function call(action, body = {}, status = 200) {
    const result = await fetch(origin + "/api/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: user.cookie },
      body: JSON.stringify(body),
    });
    if (result.headers.has("set-cookie"))
      user.cookie = result.headers.get("set-cookie").split(";")[0];
    const data = await result.json();
    assert.equal(result.status, status, action + " " + JSON.stringify(data));
    return data;
  }
  const signup = {
    username: "ponovni", firstName: "Milica", lastName: "Test",
    email: "milica@example.test", emailConfirm: "milica@example.test",
    password: "test-verification-password",
    passwordConfirm: "test-verification-password",
  };
  // Simulate provider failure AFTER account and session are written.
  const first = await call("register", signup);
  assert.equal(first.emailDeliveryFailed, true);
  assert.equal(first.me.username, "ponovni");
  assert.equal(first.preferences.verified, 0);
  assert(user.cookie.includes("sff="));

  // No duplicate user; same owner resumes normally with identical credentials.
  const second = await call("register", signup);
  assert.equal(second.me.id, first.me.id);
  assert.equal(second.emailDeliveryFailed, true);
  const state = await call("state");
  assert.equal(state.me.id, first.me.id);
  await call("profile", { name: "nešto", about: "" }, 403);

  // Invalid credentials must never let somebody claim the reserved username.
  await call("register", { ...signup,
    password: "different-password", passwordConfirm: "different-password" }, 409);
  await call("register", { ...signup,
    email: "other@example.test", emailConfirm: "other@example.test" }, 409);
  // Recovery never reveals whether an email address exists, even if the
  // provider rejects delivery or per-account throttling is reached.
  const known = await call("recoverUsername", { email: signup.email });
  const unknown = await call("recoverUsername", { email: "unknown@example.test" });
  assert.equal(known.message, unknown.message);
  await call("forgot", { email: signup.email });
  await call("forgot", { email: "unknown@example.test" });
  console.log("SFF: email outage cannot strand signups or expose account existence.");
} finally {
  server.kill();
}
