import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = mkdtempSync(join(tmpdir(), "sff-signup-"));
const server = spawn(process.execPath, [fileURLToPath(new URL("../backend/server.mjs", import.meta.url))], {
  env: { ...process.env, SFF_DATA: dir, SFF_REQUIRE_DURABLE_DB: "0", HOST: "127.0.0.1",
    TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "", SFF_REQUIRE_VERIFIED_EMAIL: "0",
    SFF_ACCOUNT_RESET_ONCE: "", RESEND_API_KEY: "", BREVO_API_KEY: "", PORT: "0" },
  stdio: ["ignore", "pipe", "inherit"],
});
try {
  const [line] = await once(server.stdout, "data");
  const origin = "http://127.0.0.1:" + line.toString().trim().split(" ").at(-1);
  async function call(action, payload, expected = 200, cookie = "") {
    const response = await fetch(origin + "/api/" + action, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    assert.equal(response.status, expected, action + ": " + JSON.stringify(result));
    return { result, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
  }
  const account = (username, email) => ({
    username, email, emailConfirm: email, password: "example-safe-pass-01",
    passwordConfirm: "example-safe-pass-01", firstName: "Same", lastName: "Name"
  });
  const first = await call("register", account("testerone", "one@example.test"));
  assert.equal(first.result.me.username,"testerone");
  assert.equal((await call("state", {}, 200, first.cookie)).result.me.username, "testerone");
  const deniedUsername = await call("register", account("testerone", "other@example.test"), 409);
  assert.match(deniedUsername.result.error, /zauzeto/i);
  const deniedEmail = await call("register", account("testertwo", "one@example.test"), 409);
  assert.match(deniedEmail.result.error, /email/i);
  await call("login", { username:"testerone", password:"wrong-safe-password" }, 401);
  const again = await call("login", { username:"testerone", password:"example-safe-pass-01" });
  assert.equal(again.result.me.username,"testerone");
  const second = await call("register", account("testertwo", "two@example.test"));
  assert.equal(second.result.me.username,"testertwo");
  const loginTwo = await call("login", { username:"testertwo", password:"example-safe-pass-01" });
  assert.equal(loginTwo.result.me.username,"testertwo");
  console.log("PASS: unique username/email, duplicate errors, new account session, two logins, same real name");
} finally {
  server.kill();
}
