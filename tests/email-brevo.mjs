// Reuse the full verification / reset test against the Brevo HTTP transport.
process.env.SFF_TEST_MAIL_PROVIDER = "brevo";
await import("./email.mjs");
