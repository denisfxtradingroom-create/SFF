import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const dir = mkdtempSync(join(tmpdir(), "sff-mail-")),
  outbox = join(dir, "outbox.json"),
  email = "test@example.test";
const server = spawn(
  process.execPath,
  [
    "--import",
    new URL("./mail-transport.mjs", import.meta.url).href,
    fileURLToPath(new URL("../backend/server.mjs", import.meta.url)),
  ],
  {
    env: {
      ...process.env,
      SFF_DATA: dir,
      PORT: "0",
      RESEND_API_KEY: "test",
      SFF_MAIL_FROM: "test@example.test",
      SFF_REQUIRE_VERIFIED_EMAIL: "1",
      SFF_TEST_OUTBOX: outbox,
    },
    stdio: ["ignore", "pipe", "inherit"],
  },
);
try {
  const [line] = await once(server.stdout, "data"),
    url = "http://127.0.0.1:" + line.toString().trim().split(" ").at(-1);
  let cookie = "";
  async function call(a, b = {}, code = 200) {
    const r = await fetch(url + "/api/" + a, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(b),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    assert.equal(r.status, code, a);
    return r.json();
  }
  const token = () =>
    JSON.parse(readFileSync(outbox, "utf8")).text.match(/[0-9a-f]{36}/)[0];
  await call("register", {
    username: "tester",
    email,
    emailConfirm: email,
    password: "old-password",
    passwordConfirm: "old-password",
    firstName: "Denis",
    lastName: "Dudas",
  });
  assert.equal((await call("state")).preferences.verified, 0);
  await call("profile", { name: "Blocked Before Verify", about: "", status: "Online", custom: "" }, 403);
  await call("verifyCode", { code: token() });
  assert.equal((await call("state")).preferences.verified, 1);
  await call("forgot", { email });
  const reset = { email, code: token(), password: "new-password" };
  await call("reset", reset);
  await call("reset", reset, 400);
  await call("state", {}, 401);
  await call("login", { username: "tester", password: "old-password" }, 401);
  await call("login", { username: "tester", password: "new-password" });
  console.log(
    "PASS: verification, single-use password reset, session revocation and new login; isolated local mail transport.",
  );
} finally {
  server.kill();
}
