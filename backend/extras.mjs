import { randomBytes, createHash, scrypt } from "node:crypto";
import { promisify } from "node:util";
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
}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS preferences(uid INTEGER PRIMARY KEY, verified INTEGER DEFAULT 0, requests INTEGER DEFAULT 1);
 CREATE TABLE IF NOT EXISTS challenges(uid INTEGER, kind TEXT, hash TEXT, expires INTEGER, PRIMARY KEY(uid,kind));
 CREATE TABLE IF NOT EXISTS alerts(uid INTEGER, scope TEXT, policy TEXT, PRIMARY KEY(uid,scope));
 CREATE TABLE IF NOT EXISTS room_meta(room INTEGER PRIMARY KEY REFERENCES rooms ON DELETE CASCADE, category TEXT DEFAULT '');
 CREATE TABLE IF NOT EXISTS artwork(scope TEXT, id INTEGER, slot TEXT, mime TEXT, bytes BLOB, PRIMARY KEY(scope,id,slot));
 CREATE TABLE IF NOT EXISTS timeouts(space INTEGER REFERENCES spaces ON DELETE CASCADE, uid INTEGER, until INTEGER, PRIMARY KEY(space,uid));`);

  const configured = () => Boolean(process.env.RESEND_API_KEY && process.env.SFF_MAIL_FROM);

  async function sendCode(uid, email, kind) {
    const token = randomBytes(18).toString("hex");
    await run(
      "insert or replace into challenges values(?,?,?,?)",
      uid,
      kind,
      hash(token),
      Date.now() + 900000,
    );
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.SFF_MAIL_FROM,
        to: [email],
        subject: kind === "reset" ? "SFF · Obnova lozinke" : "SFF · Potvrda email adrese",
        text: "Tvoj jednokratni kod je " + token + ". Važi 15 minuta.",
      }),
    });
    demand(response.ok, "Slanje pošte nije uspelo.", 503);
  }

  const options = async (u) => ({
    mail: configured(),
    requireVerifiedEmail: process.env.SFF_REQUIRE_VERIFIED_EMAIL === "1",
    preferences:
      (await one("select verified,requests from preferences where uid=?", u)) || {
        verified: 0,
        requests: 1,
      },
    alerts: await all("select scope,policy from alerts where uid=?", u),
  });

  async function handle(a, b, u, ip) {
    if (a === "capabilities") return { mail: configured() };

    if (["forgot", "reset", "verifySend", "verifyCode"].includes(a)) {
      demand(configured(), "Administrator nije povezao email servis.", 503);
      limit("mail:" + ip, 15);
      const kind = ["forgot", "reset"].includes(a) ? "reset" : "verify";
      const who =
        kind === "reset"
          ? await one("select id,email from users where email=?", str(b.email, 160).toLowerCase())
          : await one("select id,email from users where id=?", u || 0);

      if (a === "forgot" || a === "verifySend") {
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
  }

  return { options, handle, configured };
}
