import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "sff-recovery-"));
const outbox = join(directory, "outbox.json");
const server = spawn(process.execPath, [
  "--import", new URL("./mail-transport.mjs", import.meta.url).href,
  fileURLToPath(new URL("../backend/server.mjs", import.meta.url)),
], {
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "0", SFF_DATA: directory,
    RESEND_API_KEY: "test", SFF_MAIL_FROM: "test@example.test",
    SFF_REQUIRE_VERIFIED_EMAIL: "0", SFF_TEST_OUTBOX: outbox,
  },
  stdio: ["ignore", "pipe", "inherit"],
});
let origin, cookie = "";

async function call(action, body = {}, expected = 200) {
  const response = await fetch(origin + "/api/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  if (response.headers.has("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  const value = await response.json();
  assert.equal(response.status, expected, action + ": " + JSON.stringify(value));
  return value;
}

try {
  const [msg] = await once(server.stdout, "data");
  origin = "http://127.0.0.1:" + msg.toString().trim().split(" ").at(-1);
  const features = await call("capabilities");
  assert.equal(features.mail, true);

  const user = await call("register", {
    username: "korisnik98",
    email: "nalog@example.test", emailConfirm: "nalog@example.test",
    password: "old-safe-password", passwordConfirm: "old-safe-password",
    firstName: "Neko", lastName: "Test",
  });
  assert.equal(user.requireVerifiedEmail, false,
    "Enabling password recovery email must not lock existing nonverified users.");
  assert.equal((await call("state")).me.username, "korisnik98");
  assert.equal(existsSync(outbox), false,
    "Registration must not automatically start verification unless opted in.");

  // Recovery endpoints must be available BEFORE login.
  cookie = "";
  const noAccount = await call("recoverUsername", { email: "missing@example.test" });
  assert.match(noAccount.message, /Ako nalog postoji/);
  assert.equal(existsSync(outbox), false,
    "Unknown email must not cause a message with someone else's data.");

  const reminder = await call("recoverUsername", { email: "nalog@example.test" });
  assert.equal(reminder.message, noAccount.message);
  const usernameMail = JSON.parse(readFileSync(outbox, "utf8"));
  assert.match(usernameMail.subject, /korisničko ime/);
  assert.match(usernameMail.text, /@korisnik98/);
  assert(!usernameMail.text.includes("old-safe-password"));
  assert.deepEqual(usernameMail.to, ["nalog@example.test"]);

  await call("recoverUsername", { email: "neispravno" }, 400);
  await call("forgot", { email: "missing@example.test" });
  assert.equal(JSON.parse(readFileSync(outbox, "utf8")).subject,
    usernameMail.subject, "Unknown email cannot trigger password reset mail.");

  await call("forgot", { email: "nalog@example.test" });
  const resetMail = JSON.parse(readFileSync(outbox, "utf8"));
  assert.match(resetMail.subject, /Obnova lozinke/);
  const code = resetMail.text.match(/[0-9a-f]{36}/)?.[0];
  assert(code, "A one-use recovery code was not sent.");

  await call("reset", {
    email: "nalog@example.test", code, password: "new-safe-password",
    passwordConfirm: "not-the-same",
  }, 400);
  await call("reset", {
    email: "nalog@example.test", code, password: "new-safe-password",
    passwordConfirm: "new-safe-password",
  });
  await call("reset", {
    email: "nalog@example.test", code, password: "new-safe-password",
    passwordConfirm: "new-safe-password",
  }, 400);
  await call("login", { username: "korisnik98", password: "old-safe-password" }, 401);
  await call("login", { username: "korisnik98", password: "new-safe-password" });
  assert.equal((await call("state")).me.username, "korisnik98");
  console.log("SFF recovery: username email, safe unknown-address response, password reset, code reuse prevention, session revocation, and optional verification PASS");
} finally {
  server.kill();
}
