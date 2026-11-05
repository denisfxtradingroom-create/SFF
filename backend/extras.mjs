import { randomBytes, createHash, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { addMessageMetadata } from "./message-metadata.mjs";
import { retentionCutoff } from "./retention.mjs";
const hash = (v) => createHash("sha256").update(v).digest("hex"),
  derive = promisify(scrypt);

export async function extras({
  db,
  one,
  all,
  run,
  insert,
  str,
  demand,
  limit,
  blocked,
  roomFor,
  push,
  sockets,
  onDmPosted = null,
}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS preferences(uid INTEGER PRIMARY KEY, verified INTEGER DEFAULT 0, requests INTEGER DEFAULT 1);
 CREATE TABLE IF NOT EXISTS challenges(uid INTEGER, kind TEXT, hash TEXT, expires INTEGER, PRIMARY KEY(uid,kind));
 CREATE TABLE IF NOT EXISTS alerts(uid INTEGER, scope TEXT, policy TEXT, PRIMARY KEY(uid,scope));
 CREATE TABLE IF NOT EXISTS room_meta(room INTEGER PRIMARY KEY REFERENCES rooms ON DELETE CASCADE, category TEXT DEFAULT '');
 CREATE TABLE IF NOT EXISTS artwork(scope TEXT, id INTEGER, slot TEXT, mime TEXT, bytes BLOB, PRIMARY KEY(scope,id,slot));
 CREATE TABLE IF NOT EXISTS timeouts(space INTEGER REFERENCES spaces ON DELETE CASCADE, uid INTEGER, until INTEGER, PRIMARY KEY(space,uid));
 CREATE TABLE IF NOT EXISTS chat_deletions(uid INTEGER, room INTEGER REFERENCES rooms ON DELETE CASCADE, deleted_through INTEGER DEFAULT 0, time INTEGER, PRIMARY KEY(uid,room));`);

  const configured = () => Boolean(process.env.SFF_MAIL_FROM &&
    (process.env.BREVO_API_KEY || process.env.RESEND_API_KEY));
  // Recovery mail availability must not unexpectedly lock existing accounts.
  // Verification is a separate, explicit production policy.
  const requireEmail = () => process.env.SFF_REQUIRE_VERIFIED_EMAIL === "1";

  async function sendMail(email, subject, content) {
    const brevoKey = process.env.BREVO_API_KEY;
    let response;
    if (brevoKey) {
      // Brevo supports free-address senders; it may rewrite their From domain.
      const from = process.env.SFF_MAIL_FROM || "";
      const match = from.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
      const sender = match
        ? { name: match[1].trim() || "SFF", email: match[2].trim() }
        : { name: "SFF", email: from.trim() };
      response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        signal: AbortSignal.timeout(12000),
        headers: {
          "api-key": brevoKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender,
          to: [{ email }],
          subject,
          textContent: content,
        }),
      });
    } else {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(12000),
        headers: {
          Authorization: "Bearer " + process.env.RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.SFF_MAIL_FROM,
          to: [email],
          subject,
          text: content,
        }),
      });
    }
    demand(response.ok, "Slanje pošte nije uspelo.", 503);
  }

  async function sendCode(uid, email, kind) {
    const token = randomBytes(18).toString("hex");
    await run(
      "insert or replace into challenges values(?,?,?,?)",
      uid,
      kind,
      hash(token),
      Date.now() + 900000,
    );
    await sendMail(
      email,
      kind === "reset" ? "SFF · Obnova lozinke" : "SFF · Potvrda e-pošte",
      "Tvoj jednokratni SFF kod je " + token +
      ". Važi 15 minuta. Ako nisi tražio ovaj kod, ignoriši poruku.",
    );
  }

  async function sendUsernameReminder(email, username) {
    await sendMail(
      email,
      "SFF · Podsetnik za korisničko ime",
      "Korisničko ime tvog SFF naloga je @" + username +
      ". Prijavi se u SFF koristeći to ime. Ako nisi tražio ovaj podsetnik, ignoriši poruku.",
    );
  }

  const options = async (u) => ({
    mail: configured(),
    requireVerifiedEmail: requireEmail(),
    preferences:
      (await one("select verified,requests from preferences where uid=?", u)) || {
        verified: 0,
        requests: 1,
      },
    alerts: await all("select scope,policy from alerts where uid=?", u),
  });

  async function canSeeUser(u, target) {
    if (u === target) return true;
    if (
      await one(
        "select 1 from friends where accepted=1 and ((sender=? and target=?) or (sender=? and target=?))",
        u,
        target,
        target,
        u,
      )
    ) return true;
    if (
      await one(
        "select 1 from members a join members b on a.space=b.space where a.uid=? and b.uid=? limit 1",
        u,
        target,
      )
    ) return true;
    return Boolean(
      await one(
        "select 1 from participants a join participants b on a.room=b.room where a.uid=? and b.uid=? limit 1",
        u,
        target,
      ),
    );
  }

  async function detailedPush(r, event) {
    const mentions = event.mentions || [];
    const active = [...sockets].filter((s) => s.readyState === 1);
    if (!active.length) return;
    // Authorize once per user, not once for every tab / connected device.
    const users = [...new Set(active.map((s) => s.uid))];
    const authorized = new Map();
    for (const uid of users) {
      const room = await roomFor(r.id, uid);
      if (room) authorized.set(uid, room);
    }
    if (!authorized.size) return;
    const ids = [...authorized.keys()];
    const placeholders = ids.map(() => "?").join(",");
    const spaceScope = r.space ? "s" + r.space : null;
    // One indexed policy query replaces 2-3 queries per connected recipient.
    const settings = await all(
      "select u.id,u.username,u.status," +
      "(select policy from alerts where uid=u.id and scope=?) roomPolicy," +
      (spaceScope
        ? "(select policy from alerts where uid=u.id and scope=?) spacePolicy "
        : "null spacePolicy ") +
      "from users u where u.id in (" + placeholders + ")",
      "r" + r.id, ...(spaceScope ? [spaceScope] : []), ...ids
    );
    const byId = new Map(settings.map((row) => [row.id, row]));
    for (const s of active) {
      const room = authorized.get(s.uid);
      if (!room) continue;
      const person = byId.get(s.uid);
      let notify = s.uid !== event.uid && person?.status !== "Do Not Disturb";
      const policy = person?.roomPolicy || person?.spacePolicy || "all";
      if (policy === "off") notify = false;
      else if (policy === "mentions") {
        const role = room.role?.toLowerCase();
        notify = notify && mentions.some((n) =>
          [person?.username, "everyone", role].filter(Boolean).includes(n));
      }
      s.send(JSON.stringify({ ...event, room: r.id, notify }));
    }
  }

  function mediaMime(bytes, filename) {
    const lower = String(filename || "").toLowerCase();
    if (bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
    if (bytes[0] === 255 && bytes[1] === 216) return "image/jpeg";
    if (bytes.subarray(0, 3).toString() === "GIF") return "image/gif";
    if (bytes.length > 12 && bytes.subarray(4, 8).toString() === "ftyp" && lower.endsWith(".mp4")) return "video/mp4";
    if (bytes.length > 12 && bytes.subarray(4, 8).toString() === "ftyp" && lower.endsWith(".m4a")) return "audio/mp4";
    if (bytes.subarray(0, 4).toString("hex") === "1a45dfa3" && lower.endsWith(".webm")) return "audio/webm";
    if (bytes.subarray(0, 4).toString() === "OggS" && lower.endsWith(".ogg")) return "audio/ogg";
    if ((bytes.subarray(0, 3).toString() === "ID3" || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) && lower.endsWith(".mp3")) return "audio/mpeg";
    return "application/octet-stream";
  }

  async function handle(a, b, u, ip) {
    if (a === "capabilities") return { mail: configured() };

    if (a === "recoverUsername") {
      demand(configured(), "Oporavak naloga preko e-pošte trenutno nije aktivan.", 503);
      limit("mail:" + ip, 15);
      const email = str(b.email, 160).toLowerCase();
      demand(/^\S+@\S+\.\S+$/.test(email), "Unesi ispravnu e-poštu.", 400);
      const who = await one(
        "select id,email,username from users where email=?",
        email,
      );
      if (who) {
        try {
          limit("send:" + who.id, 3);
          await sendUsernameReminder(who.email, who.username);
        } catch (error) {
          // Never reveal whether this address belongs to a user by
          // returning a different HTTP status for an email provider error.
          console.warn("[SFF recovery] Username reminder delivery failed:", error.message);
        }
      }
      return { message: "Ako nalog postoji, korisničko ime biće poslato na e-poštu." };
    }

    if (["forgot", "reset", "verifySend", "verifyCode"].includes(a)) {
      demand(configured(), "Administrator nije povezao email servis.", 503);
      limit("mail:" + ip, 15);
      const kind = ["forgot", "reset"].includes(a) ? "reset" : "verify";
      const who =
        kind === "reset"
          ? await one("select id,email from users where email=?", str(b.email, 160).toLowerCase())
          : await one("select id,email from users where id=?", u || 0);

      if (a === "forgot") {
        if (who) {
          try {
            limit("send:" + who.id, 3);
            await sendCode(who.id, who.email, kind);
          } catch (error) {
            // Same response for existent/nonexistent addresses, even if
            // the email provider fails or per-account throttling is hit.
            console.warn("[SFF recovery] Password reset email delivery failed:", error.message);
          }
        }
        return {};
      }
      if (a === "verifySend") {
        if (who) {
          limit("send:" + who.id, 3);
          await sendCode(who.id, who.email, kind);
        }
        return {};
      }

      const code = str(b.code, 72);
      demand(who, "Kod nije važeći.", 400);
      const proof = await one(
        "select * from challenges where uid=? and kind=? and hash=? and expires>?",
        who.id,
        kind,
        hash(code),
        Date.now(),
      );
      demand(proof, "Kod nije važeći.", 400);

      let password;
      if (kind === "reset") {
        const salt = randomBytes(24).toString("hex");
        demand(
          typeof b.password === "string" && b.password.length >= 8 && b.password.length <= 128,
          "Lozinka mora imati 8–128 znakova.",
          400,
        );
        demand(
          b.passwordConfirm === undefined || b.password === b.passwordConfirm,
          "Nove lozinke se ne podudaraju.", 400,
        );
        password = salt + "." + (await derive(b.password, salt, 64)).toString("hex");
      }

      await db.transaction(async (tx) => {
        const deleted = await tx.run(
          "delete from challenges where uid=? and kind=? and hash=?",
          who.id,
          kind,
          proof.hash,
        );
        demand(deleted.changes);
        if (password) {
          await tx.run("update users set password=? where id=?", password, who.id);
          await tx.run("delete from sessions where uid=?", who.id);
        } else {
          await tx.run(
            "insert into preferences(uid,verified) values(?,1) on conflict(uid) do update set verified=1",
            who.id,
          );
        }
      });

      if (password) for (const s of sockets) if (s.uid === who.id) s.close();
      return {};
    }

    if (!u) return;

    if (a === "hiddenChats") {
      return await all(
        "select d.room from chat_deletions d join participants p on p.room=d.room and p.uid=d.uid where d.uid=? and coalesce((select max(id) from messages where room=d.room),0)<=d.deleted_through",
        u,
      );
    }

    if (a === "deleteChat") {
      const r = await roomFor(Number(b.room), u);
      demand(r && !r.space && ["dm", "group"].includes(r.kind), "Razgovor nije dostupan.", 404);
      const latest = (await one("select coalesce(max(id),0) id from messages where room=?", r.id))?.id || 0;
      await run(
        "insert into chat_deletions(uid,room,deleted_through,time) values(?,?,?,?) on conflict(uid,room) do update set deleted_through=max(deleted_through,excluded.deleted_through),time=excluded.time",
        u,
        r.id,
        latest,
        Date.now(),
      );
      await run(
        "insert into reads(room,uid,last) values(?,?,?) on conflict(room,uid) do update set last=max(last,excluded.last)",
        r.id,
        u,
        latest,
      );
      await push({ type: "state" }, (s) => s.uid === u);
      return {};
    }

    if (a === "chatInfo") {
      const r = await roomFor(Number(b.room), u);
      demand(r && !r.space, "Razgovor nije dostupan.", 404);
      const participants = await all(
        "select u.id,u.username,u.name,u.about,u.status,u.custom from participants p join users u on u.id=p.uid where p.room=? and p.uid!=?",
        r.id,
        u,
      );
      return { id: r.id, kind: r.kind, name: r.name, participants };
    }

    if (a === "userProfile") {
      const target = b.id
        ? Number(b.id)
        : (await one("select id from users where username=?", str(b.username, 30).toLowerCase()))?.id;
      demand(target && (await canSeeUser(u, target)), "Profil nije dostupan.", 404);
      const p = await one("select id,username,name,about,status,custom from users where id=?", target);
      const artwork = await all("select slot from artwork where scope='user' and id=?", target);
      const connected = [...sockets].some((s) => s.uid === target && s.readyState === 1);
      const visible = p.status !== "Invisible" || target === u;
      return {
        ...p,
        online: visible && connected,
        displayStatus: !visible || !connected ? "Offline" : p.status,
        avatar: artwork.some((a) => a.slot === "avatar"),
        banner: artwork.some((a) => a.slot === "banner"),
      };
    }

    if (a === "privacy") {
      await run(
        "insert into preferences(uid,requests) values(?,?) on conflict(uid) do update set requests=excluded.requests",
        u,
        b.requests ? 1 : 0,
      );
      return {};
    }

    if (a === "alerts") {
      demand(["all", "mentions", "off"].includes(b.policy));
      const scope = str(b.scope, 48);
      demand(/^[sr]\d+$/.test(scope));
      await run("insert or replace into alerts values(?,?,?)", u, scope, b.policy);
      return {};
    }

    if (a === "group") {
      const names = [
        ...new Set(
          str(b.names, 320)
            .split(",")
            .map((x) => x.trim().toLowerCase()),
        ),
      ];
      demand(names.length >= 2 && names.length <= 8, "Izaberi 2–8 prijatelja.", 400);
      const ids = [];
      for (const name of names) ids.push((await one("select id from users where username=?", name))?.id);
      for (const p of ids) {
        demand(
          p &&
            p !== u &&
            (await one(
              "select 1 from friends where accepted=1 and ((sender=? and target=?) or (sender=? and target=?))",
              u,
              p,
              p,
              u,
            )),
          "Članovi moraju biti tvoji prijatelji.",
        );
      }
      for (const x of ids) for (const y of ids) demand(!(await blocked(x, y)));
      const name = str(b.name, 72);
      const id = await db.transaction(async (tx) => {
        const roomId = await tx.insert("insert into rooms(name,kind) values(?,'group')", name);
        for (const p of [u, ...ids]) await tx.run("insert into participants values(?,?)", roomId, p);
        return roomId;
      });
      push({ type: "state" }, (s) => ids.includes(s.uid));
      return { id };
    }

    if (a === "art") {
      const scope = b.scope === "space" ? "space" : "user",
        id = scope === "space" ? b.space : u;
      demand(scope === "user" || (await one("select 1 from spaces where id=? and owner=?", id, u)));
      demand(["avatar", "banner"].includes(b.slot));
      const bytes = Buffer.from(str(b.data, 1400000), "base64");
      demand(bytes.length <= 1024000);
      const mime =
        bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216
            ? "image/jpeg"
            : null;
      demand(mime, "Odaberi PNG ili JPG do 1 MB.", 400);
      await run("insert or replace into artwork values(?,?,?,?,?)", scope, id, b.slot, mime, bytes);
      return {};
    }

    if (a === "category") {
      const r = await roomFor(b.room, u);
      demand(r?.space && r.role !== "Member");
      await run("insert or replace into room_meta values(?,?)", r.id, str(b.category, 40, 0));
      return {};
    }

    if (a === "timeout") {
      const m = await one("select role from members where uid=? and space=?", u, b.space),
        t = await one("select role from members where uid=? and space=?", b.target, b.space);
      demand(m && m.role !== "Member" && t?.role === "Member");
      await run("insert or replace into timeouts values(?,?,?)", b.space, b.target, Date.now() + 600000);
      await run(
        "insert into audit(space,uid,action,time) values(?,?,?,?)",
        b.space,
        u,
        "timeout #" + b.target,
        Date.now(),
      );
      for (const s of sockets) {
        if (s.uid === b.target && s.voice && (await roomFor(s.voice, u))?.space === b.space) s.close();
      }
      return {};
    }

    if (a === "history") {
      const r = await roomFor(b.room, u);
      if (!r || r.space) return;
      const deleted = await one("select deleted_through from chat_deletions where uid=? and room=?", u, r.id);
      if (!deleted) return;
      const rows = (
        await all(
          "select m.id,m.uid,case when m.time<=? and m.file is not null and trim(coalesce(m.body,''))='' then 'Prilog je uklonjen nakon 7 dana.' else m.body end body,m.parent,m.time,m.pinned,m.edited,case when m.time<=? then null else m.file end file,case when m.time<=? then null else m.mime end mime,u.name,u.username from messages m join users u on u.id=m.uid where room=? and m.id>? and ((?=0 and not exists(select 1 from thread_posts t where t.msg=m.id)) or m.id=? or exists(select 1 from thread_posts t where t.msg=m.id and t.root=?)) and m.id<? and instr(lower(m.body),lower(?))>0 and m.pinned>=? order by m.id desc limit 50",
          retentionCutoff(), retentionCutoff(), retentionCutoff(), r.id,
          deleted.deleted_through,
          Number(b.thread) || 0,
          Number(b.thread) || 0,
          Number(b.thread) || 0,
          Number(b.before) || Number.MAX_SAFE_INTEGER,
          str(b.search || "", 120, 0),
          b.pins ? 1 : 0,
        )
      ).reverse();
      return addMessageMetadata(rows, all, deleted.deleted_through);
    }

    if (a === "post") {
      demand(process.env.SFF_REQUIRE_VERIFIED_EMAIL !== "1" || (await one("select verified from preferences where uid=?", u))?.verified, "Potvrdi email adresu pre korišćenja aplikacije.", 403);
      const r = await roomFor(b.room, u);
      demand(r);
      demand(!r.space || r.canPost);
      demand(
        !r.space ||
          !(await one("select 1 from timeouts where space=? and uid=? and until>?", r.space, u, Date.now())),
        "Privremeno utišan nalog.",
      );
      limit("post" + u, 65);
      demand(r.kind !== "announcement" || r.role !== "Member");
      const body = str(b.body || "", 4000, 0);
      demand(body || b.file, "Poruka je prazna.", 400);
      if (b.parent) demand(await one("select id from messages where id=? and room=?", b.parent, r.id));
      if (b.thread)
        demand(
          await one(
            "select id from messages where id=? and room=? and not exists(select 1 from thread_posts where msg=messages.id)",
            b.thread,
            r.id,
          ),
        );

      let bytes = null,
        file = null,
        mime = null;
      if (b.file) {
        limit("upload:" + u, 10);
        file = str(b.file, 120).replace(/[^\p{L}\p{N} ._-]/gu, "_");
        bytes = Buffer.from(str(b.data, 7e6), "base64");
        demand(bytes.length && bytes.length <= 5 * 1024 * 1024, "Najviše 5 MB.", 400);
        mime = mediaMime(bytes, file);
        demand(
          ["image/png", "image/jpeg", "image/gif", "video/mp4", "audio/mpeg", "audio/webm", "audio/ogg", "audio/mp4", "application/octet-stream"].includes(mime),
          "Nepodržan fajl.",
          400,
        );
      }

      const id = await insert(
        "insert into messages(room,uid,body,parent,time,file,mime,bytes) values(?,?,?,?,?,?,?,?)",
        r.id,
        u,
        body,
        b.parent || null,
        Date.now(),
        file,
        mime,
        bytes,
      );
      if (b.thread) await run("insert into thread_posts values(?,?)", id, b.thread);
      const sender = await one("select name,username from users where id=?", u);
      const mentions = [...body.matchAll(/@([a-z0-9_]+)/gi)]
        .map((m) => m[1].toLowerCase())
        .filter(
          (n) =>
            !["everyone", "administrator", "moderator", "member"].includes(n) ||
            r.role === "Administrator" ||
            r.role === "Moderator",
        );
      await detailedPush(r, {
        type: "message",
        id,
        uid: u,
        name: sender?.name || sender?.username || "Korisnik",
        body: body.slice(0, 120),
        file,
        mime,
        mentions,
      });
      // This is the ACTIVE /api/post handler. It previously returned before
      // server.mjs's Firebase push branch could ever run.
      if (r.kind === "dm" && !r.space && typeof onDmPosted === "function") {
        void onDmPosted({
          room:r.id,authorUid:u,messageId:id,
          senderName:sender?.name || sender?.username || "Korisnik",
          body,hasFile:Boolean(file)
        }).catch(error=>
          console.warn("[SFF push] DM notification unavailable:",error.message));
      }
      return { id };
    }
  }

  return { options, handle, configured, requireEmail };
}
