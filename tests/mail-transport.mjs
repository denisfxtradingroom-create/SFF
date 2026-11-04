import { writeFileSync } from "node:fs";
const original = globalThis.fetch;
// Only imported by the email integration test in its own temporary server process.
globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://api.resend.com/emails")
    return original(url, init);
  const mail = JSON.parse(init.body);
  writeFileSync(process.env.SFF_TEST_OUTBOX, JSON.stringify(mail));
  if (process.env.SFF_TEST_MAIL_FAIL === "1") {
    return new Response(JSON.stringify({ error: "Simuliran prekid slanja pošte" }), {
      status: 503,
    });
  }
  return new Response(JSON.stringify({ id: "local-integration-test" }), {
    status: 200,
  });
};
