import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const original = globalThis.fetch;
// Only imported by the email integration test in its own temporary server process.
globalThis.fetch = async (url, init) => {
  const brevo = String(url) === "https://api.brevo.com/v3/smtp/email";
  if (!brevo && String(url) !== "https://api.resend.com/emails")
    return original(url, init);
  const mail = JSON.parse(init.body);
  if (brevo) {
    assert.equal(init.headers["api-key"], "test");
    assert.deepEqual(mail.sender, { name: "SFF", email: "test@example.test" });
    assert.deepEqual(mail.to, [{ email: "test@example.test" }]);
    assert.equal(typeof mail.textContent, "string");
  }
  writeFileSync(process.env.SFF_TEST_OUTBOX, JSON.stringify(mail));
  if (process.env.SFF_TEST_MAIL_FAIL === "1") {
    return new Response(JSON.stringify({ error: "Simuliran prekid slanja pošte" }), {
      status: 503,
    });
  }
  return new Response(JSON.stringify({ id: "local-integration-test" }), {
    status: brevo ? 201 : 200,
  });
};
