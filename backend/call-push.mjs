// Private Android FCM push transport. No project credentials are stored in code.
// Safe to deploy before Firebase is configured; sends stay disabled.
import { createHash } from "node:crypto";

const sha256 = (token) => createHash("sha256").update(token).digest("hex");
const tokenPattern = /^[A-Za-z0-9_.:\-~]+$/;
let messaging;
let initPromise;

export const pushConfigured = () => Boolean(
  (process.env.SFF_FCM_SERVICE_ACCOUNT_JSON || "").trim()
);

async function getMessagingClient() {
  if (!pushConfigured()) return null;
  if (messaging) return messaging;
  if (!initPromise) initPromise = (async () => {
    const key = JSON.parse(process.env.SFF_FCM_SERVICE_ACCOUNT_JSON);
    if (!key.project_id || !key.private_key || !key.client_email)
      throw Error("Nepotpuni Firebase serverski podaci.");
    const [{ initializeApp, cert }, { getMessaging }] = await Promise.all([
      import("firebase-admin/app"), import("firebase-admin/messaging")
    ]);
    const app = initializeApp({ credential: cert(key) }, "sff-calls-push");
    return getMessaging(app);
  })();
  try { messaging = await initPromise; }
  catch (error) { initPromise = null; throw error; }
  return messaging;
}

export async function createPushDevices(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sff_push_devices (
      token_hash TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      uid INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session TEXT NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sff_push_devices_uid_updated
      ON sff_push_devices(uid,updated);
    CREATE INDEX IF NOT EXISTS sff_push_devices_session
      ON sff_push_devices(session);
  `);

  const validateToken = (token) => {
    if (typeof token !== "string" || token.length < 20 ||
        token.length > 4096 || !tokenPattern.test(token))
      throw Object.assign(Error("Neispravan Android push token."), { status:400 });
    return token;
  };

  async function register(uid, session, rawToken) {
    const token = validateToken(rawToken);
    const now = Date.now();
    await db.run(
      "insert into sff_push_devices(token_hash,token,uid,session,updated) " +
      "values(?,?,?,?,?) on conflict(token_hash) do update set " +
      "token=excluded.token,uid=excluded.uid,session=excluded.session,updated=excluded.updated",
      sha256(token),token,uid,session,now
    );
    // A device refresh is infrequent. Remove excess/stale tokens only then.
    await db.run(
      "delete from sff_push_devices where uid=? and token_hash not in (" +
      "select token_hash from sff_push_devices where uid=? order by updated desc limit 8)",
      uid,uid
    );
  }
  const forgetSession = (session) => db.run(
    "delete from sff_push_devices where session=?",session
  );
  const unregister = (uid, session, token) => db.run(
    "delete from sff_push_devices where uid=? and session=? and token_hash=?",
    uid,session,sha256(validateToken(token))
  );
  const list = async (uid) => {
    const rows = await db.all(
      "select token from sff_push_devices where uid=? and updated>? order by updated desc limit 8",
      uid,Date.now()-60*24*60*60*1000
    );
    return rows.map((x) => x.token);
  };
  async function sendCall(uid, details, sendOverride = null) {
    if (!pushConfigured()) return false;
    const tokens = await list(uid);
    if (!tokens.length) return false;
    let succeeded = 0;
    const payload = {
      // DATA-only FCM: this calls FirebaseMessagingService even in background;
      // the native app shows the ringtone notification immediately.
      data: {
        type: "call_incoming",
        room: String(details.room),
        kind: details.kind === "video" ? "video" : "audio",
        created_at: String(Date.now()),
      },
      android: {
        priority: "high",
        ttl: 45000,
        restrictedPackageName: "app.sff.signal",
      },
    };
    let sender;
    try {
      const client = sendOverride ? null : await getMessagingClient();
      sender = sendOverride || client.send.bind(client);
    } catch (error) {
      console.warn("[SFF push] Firebase transport unavailable:",error.message);
      return false;
    }
    for (const token of tokens) {
      try {
        await sender({...payload,token});
        succeeded++;
      } catch (error) {
        const code = String(error.code || "");
        if (code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token")
          await db.run("delete from sff_push_devices where token_hash=?",sha256(token));
        else console.warn("[SFF push] Delivery failed:",code || "send_error");
      }
    }
    return succeeded > 0;
  }
  return {register,unregister,forgetSession,list,sendCall};
}
