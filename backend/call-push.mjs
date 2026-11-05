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

  // Ephemeral, user-scoped delivery diagnostics. Never store message text,
  // device tokens, login credentials or user-visible contact information.
  const recentDm = new Map();
  function dmResult(uid, state, registeredDevices=0, firebaseAccepted=0) {
    recentDm.delete(uid);
    recentDm.set(uid, {
      state, at: Date.now(),
      registeredDevices, firebaseAccepted,
    });
    if (recentDm.size > 256)
      recentDm.delete(recentDm.keys().next().value);
    console.info("[SFF push] DM delivery:",
      state, "devices=" + registeredDevices,
      "firebaseAccepted=" + firebaseAccepted);
  }
  
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
        name: String(details.name || "Korisnik").replace(/[\r\n\t]/g," ").slice(0,80),
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
  // Private DM push with an optional message preview, as requested by users.
  // Never include session cookies, passwords or other credentials in FCM data.
  async function sendMessage(uid, details, sendOverride = null) {
    if (!pushConfigured()) {
      dmResult(uid, "not_configured");
      return false;
    }
    const room = Number(details?.room);
    const messageId = Number(details?.messageId);
    if (!Number.isSafeInteger(room) || room < 1 ||
        !Number.isSafeInteger(messageId) || messageId < 1) {
      dmResult(uid, "invalid_message");
      return false;
    }
    const tokens = await list(uid);
    if (!tokens.length) {
      dmResult(uid, "no_registered_devices");
      return false;
    }
    const payload = {
      data: {
        type: "dm_message",
        room: String(room),
        message_id: String(messageId),
        sender: String(details.sender || "Korisnik").replace(/[\r\n\t]/g, " ").slice(0, 80),
        body: String(details.body || (details.hasFile ? "Poslat je prilog." : "Nova poruka"))
          .replace(/[\r\n\t]/g, " ").slice(0, 240),
      },
      android: {
        priority: "high",
        ttl: 24 * 60 * 60 * 1000,
        restrictedPackageName: "app.sff.signal",
      },
    };
    let sender;
    try {
      const client = sendOverride ? null : await getMessagingClient();
      sender = sendOverride || client.send.bind(client);
    } catch (error) {
      dmResult(uid, "firebase_unavailable", tokens.length);
      console.warn("[SFF push] DM transport unavailable:", error.message);
      return false;
    }
    let succeeded = 0;
    for (const token of tokens) {
      try {
        await sender({ ...payload, token });
        succeeded++;
      } catch (error) {
        const code = String(error?.code || "");
        if (code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token")
          await db.run("delete from sff_push_devices where token_hash=?", sha256(token));
        else console.warn("[SFF push] DM delivery failed:", code || "send_error");
      }
    }
    dmResult(uid, succeeded ? "firebase_accepted" : "firebase_rejected",
      tokens.length, succeeded);
    return succeeded > 0;
  }
  // User-scoped diagnostics: never return tokens, cookies or Firebase secrets.
  async function status(uid) {
    const row = await db.one(
      "select count(*) as devices,max(updated) as last_registration " +
      "from sff_push_devices where uid=? and updated>?",
      uid,Date.now()-60*24*60*60*1000
    );
    return {
      configured: pushConfigured(),
      registeredDevices: Number(row?.devices || 0),
      lastRegistration: Number(row?.last_registration || 0),
      // Acknowledgement only: Android may still suppress or drop a notification.
      latestMessagePush: recentDm.get(uid) || null,
    };
  }

  // Send a direct system-notification test only to the logged-in user's own
  // Android devices. FCM acknowledgement is NOT proof of phone delivery.
  async function sendSelfTest(uid, sendOverride = null) {
    const info = await status(uid);
    if (!info.configured || !info.registeredDevices)
      return { ...info, acceptedByFirebase: false };
    const tokens = await list(uid);
    let sender;
    try {
      const client = sendOverride ? null : await getMessagingClient();
      sender = sendOverride || client.send.bind(client);
    } catch (error) {
      console.warn("[SFF push] self-test transport unavailable:",error.message);
      return { ...info, acceptedByFirebase: false };
    }
    let successes = 0;
    for (const token of tokens) {
      try {
        await sender({
          token,
          data: {
            type:"push_self_test",
            title:"SFF · Test notifikacije",
            body:"Ako vidiš ovu poruku, Firebase push stiže na telefon."
          },
          android: {
            priority:"high",
            ttl:60000,
            restrictedPackageName:"app.sff.signal"
          }
        });
        successes++;
      } catch (error) {
        const code=String(error?.code || "");
        if (code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token")
          await db.run("delete from sff_push_devices where token_hash=?",sha256(token));
        else console.warn("[SFF push] self-test failed:",code || "send_error");
      }
    }
    return { ...info, acceptedByFirebase: successes > 0 };
  }
  return {register,unregister,forgetSession,list,sendCall,sendMessage,status,sendSelfTest};
}
