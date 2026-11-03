import { rolePolicy } from "./roles.mjs";
import { extras } from "./extras.mjs";
import { openDatabase } from "./db.mjs";
import http from "node:http";
import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const root = dirname(fileURLToPath(import.meta.url));
const db = await openDatabase();
await db.exec(readFileSync(resolve(root, "schema.sql"), "utf8"));
const { all, one, run, insert } = db;

const passwordInput = (v) => {
  demand(
    typeof v === "string" && v.length >= 8 && v.length <= 128,
    "Lozinka mora imati 8–128 znakova.",
    400,
  );
  return v;
};
const key = () => randomBytes(32).toString("hex"),
  digest = (x) => createHash("sha256").update(x).digest("hex"),
  derive = promisify(scrypt);
const demand = (condition, message = "Pristup odbijen.", status = 403) => {
  if (!condition) throw Object.assign(Error(message), { status });
};
const str = (v, max, min = 1) => {
  demand(
    typeof v === "string" && v.trim().length >= min && v.length <= max,
    "Proveri unetu vrednost.",
    400,
  );
  return v.trim();
};
const profile = "id,username,email,name,about,status,custom";
const member = (s, u) => one("select * from members where space=? and uid=?", s, u);
const blocked = (a, b) =>
  one(
    "select 1 from blocks where (uid=? and target=?) or (uid=? and target=?)",
    a,
    b,
    b,
    a,
  );
const policy = await rolePolicy({ db, one, all, run, member, demand, str });

async function roomFor(id, u) {
  const r = await one("select * from rooms where id=?", id);
  if (!r) return;
  if (r.space) {
    const m = await member(r.space, u);
    if (!m) return;
    const permissions = await policy.access(r, m);
    return permissions.visible ? { ...r, ...permissions, role: m.role } : null;
  }
  if (!(await one("select 1 from participants where room=? and uid=?", id, u))) return;
  const participants = await all("select uid from participants where room=?", id);
  for (const p of participants) if (await blocked(u, p.uid)) return null;
  return r;
}

const wss = new WebSocketServer({ noServer: true, maxPayload: 131072 }),
  sockets = new Set(),
  rates = new Map();
function limit(k, n) {
  const now = Date.now();
  let r = rates.get(k);
  if (!r || now > r.end) rates.set(k, (r = { count: 0, end: now + 60000 }));
  demand(++r.count <= n, "Previše zahteva. Pokušaj za minut.", 429);
}
setInterval(async () => {
  try {
    for (const [k, r] of rates) if (r.end < Date.now()) rates.delete(k);
    await run("delete from sessions where expires<?", Date.now());
    for (const s of sockets) if (!(await session(s.token))) s.close();
  } catch (error) {
    console.error("SFF maintenance:", error);
  }
}, 60000).unref();
const session = async (t) =>
  t && (await one("select uid from sessions where token=? and expires>?", t, Date.now()))?.uid;
const push = async (event, filter) => {
  for (const s of sockets) {
    if ((await filter(s)) && s.readyState === 1) s.send(JSON.stringify(event));
  }
};
const extra = await extras({
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
});
function auth(req) {
  return (req.headers.cookie || "").match(/(?:^|; *)sff=([a-f0-9]{64})(?:;|$)/)?.[1];
}

async function state(u) {
  const spaces = await all(
    "select s.*,m.role from spaces s join members m on m.space=s.id where m.uid=?",
    u,
  );
  const ids = await all(
    "select r.id from rooms r join members m on m.space=r.space where m.uid=? union select room as id from participants where uid=?",
    u,
    u,
  );
  const rooms = [];
  for (const x of ids) {
    const r = await roomFor(x.id, u);
    if (!r) continue;
    const latest = await one("select max(id) latest from messages where room=?", r.id);
    const deleted = !r.space
      ? await one("select deleted_through from chat_deletions where room=? and uid=?", r.id, u)
      : null;
    if (deleted && (latest?.latest || 0) <= deleted.deleted_through) continue;
    let roomName = r.name;
    if (r.kind === "dm") {
      const names = await all(
        "select name from users join participants on users.id=uid where room=? and uid!=?",
        r.id,
        u,
      );
      roomName = names.map((x) => x.name).join(", ");
    }
    const unread = await one(
      "select count(*) n from messages where room=? and uid!=? and id>max(coalesce((select last from reads where room=? and uid=?),0),?)",
      r.id,
      u,
      r.id,
      u,
      deleted?.deleted_through || 0,
    );
    const meta = await one("select category from room_meta where room=?", r.id);
    rooms.push({
      ...r,
      lastActivity: latest?.latest || 0,
      name: roomName,
      unread: unread?.n || 0,
      category: meta?.category || "",
    });
  }

  const onlineIds = [];
  for (const id of new Set([...sockets].map((s) => s.uid))) {
    const user = await one("select id from users where id=? and status!='Invisible'", id);
    const friend = await one(
      "select 1 from friends where accepted=1 and ((sender=? and target=?) or (sender=? and target=?))",
      u,
      id,
      id,
      u,
    );
    if (user && friend) onlineIds.push(id);
  }

  return {
    ...(await extra.options(u)),
    online: onlineIds,
    art: await all(
      "select scope,id,slot from artwork where (scope='user' and (id=? or id in(select uid from members where space in(select space from members where uid=?)) or id in(select uid from participants where room in(select room from participants where uid=?)) or id in(select case when sender=? then target else sender end from friends where accepted=1 and (sender=? or target=?)))) or (scope='space' and id in(select space from members where uid=?))",
      u,
      u,
      u,
      u,
      u,
      u,
      u,
    ),
    me: await one("select " + profile + " from users where id=?", u),
    spaces,
    rooms,
    friends: await all(
      "select f.*,u.id,u.name,u.username from friends f join users u on u.id=case when sender=? then target else sender end where sender=? or target=?",
      u,
      u,
      u,
    ),
    blocks: await all(
      "select u.id,u.username from blocks b join users u on u.id=b.target where uid=?",
      u,
    ),
  };
}
async function action(a, b, u, res, req) {
  const ip = req.socket.remoteAddress;
  limit(ip + ":api", 900);
  const result = await extra.handle(a, b, u, ip);
  if (result !== undefined) return result;
  if (a === "register" || a === "login") {
    limit(ip + ":auth", 35);
    const username = str(b.username, 30).toLowerCase(),
      pw = passwordInput(b.password);
    let user = await one("select * from users where username=?", username);
    if (a === "register") {
      const email = str(b.email, 160).toLowerCase(),
        emailConfirm = str(b.emailConfirm, 160).toLowerCase(),
        firstName = str(b.firstName, 40),
        lastName = str(b.lastName, 40),
        displayName = firstName + " " + lastName;
      demand(
        /^[a-z0-9_]{3,30}$/.test(username),
        "Korisničko ime mora imati 3–30 znakova i može sadržati samo mala slova, brojeve i _.",
        400,
      );
      demand(/^\S+@\S+\.\S+$/.test(email), "Unesi ispravnu email adresu.", 400);
      demand(email === emailConfirm, "Email adrese se ne podudaraju.", 400);
      demand(b.password === b.passwordConfirm, "Lozinke se ne podudaraju.", 400);
      demand(/^\p{L}[\p{L} .'-]*$/u.test(firstName) && /^\p{L}[\p{L} .'-]*$/u.test(lastName), "Ime i prezime mogu sadržati samo slova, razmake, apostrof, tačku i crticu.", 400);
      demand(!user, "Username already taken — ovo korisničko ime je već zauzeto.", 409);
      demand(
        !await one("select id from users where lower(name)=lower(?)", displayName),
        "Name already taken — ovo ime i prezime je već zauzeto.",
        409,
      );
      demand(!await one("select id from users where email=?", email), "Za tu email adresu već postoji nalog.", 409);
      demand(!extra.requireEmail() || extra.configured(), "Email servis nije konfigurisan. Registracija trenutno nije dostupna.", 503);
      const salt = key(),
        hash = (await derive(pw, salt, 64)).toString("hex");
      await run(
        "insert into users(username,email,password,name) values(?,?,?,?)",
        username,
        email,
        salt + "." + hash,
        displayName,
      );
      user = await one("select * from users where username=?", username);
    } else {
      const [salt, hash] = (
        user?.password || "invalid." + "0".repeat(128)
      ).split(".");
      const actual = await derive(pw, salt, 64);
      demand(
        user && timingSafeEqual(actual, Buffer.from(hash, "hex")),
        "Neuspešna prijava.",
        401,
      );
    }
    const stayLoggedIn = b.remember !== false && b.remember !== "0";
    const t = key();
    await run(
      "insert into sessions values(?,?,?)",
      digest(t),
      user.id,
      Date.now() + (stayLoggedIn ? 90 : 0.5) * 86400000,
    );
    res.setHeader(
      "Set-Cookie",
      "sff=" +
        t +
        "; HttpOnly; SameSite=Strict; Path=/" +
        (stayLoggedIn ? "; Max-Age=7776000" : "") +
        (process.env.SFF_HTTPS === "1" ? "; Secure" : ""),
    );
    if (a === "register" && extra.requireEmail())
      await extra.handle("verifySend", {}, user.id, ip);
    return await state(user.id);
  }
  demand(u, "Prijavi se.", 401);
  if (extra.requireEmail() && !(await one("select verified from preferences where uid=?", u))?.verified)
    demand(["state", "logout"].includes(a), "Potvrdi email adresu pre korišćenja aplikacije.", 403);
  const roleResult = await policy.handle(a, b, u);
  if (roleResult !== undefined) {
    if (a !== "roles") {
      for (const s of sockets)
        if (s.voice && !(await roomFor(s.voice, s.uid))?.canVoice) s.close();
      await push({ type: "state" }, (s) => member(b.space, s.uid));
    }
    return roleResult;
  }
  const update = (uids) => push({ type: "state" }, (s) => uids.includes(s.uid));
  if (a === "state") return await state(u);
  if (a === "logout") {
    const t = digest(auth(req));
    await run("delete from sessions where token=?", t);
    for (const s of sockets) if (s.token === t) s.close();
    res.setHeader("Set-Cookie", "sff=; Path=/; Max-Age=0");
    return {};
  }
  if (a === "profile") {
    demand(
      ["Online", "Idle", "Do Not Disturb", "Invisible"].includes(b.status),
    );
    const displayName = str(b.name, 80);
    demand(
      !await one("select id from users where lower(name)=lower(?) and id!=?", displayName, u),
      "Name already taken — ovo ime i prezime je već zauzeto.",
      409,
    );
    await run(
      "update users set name=?,about=?,status=?,custom=? where id=?",
      displayName,
      str(b.about, 400, 0),
      b.status,
      str(b.custom, 100, 0),
      u,
    );
    return {};
  }
  if (a === "password") {
    const passwordRow = await one("select password from users where id=?", u);
    const [salt, hash] = passwordRow.password.split(".");
    demand(
      timingSafeEqual(
        await derive(passwordInput(b.old), salt, 64),
        Buffer.from(hash, "hex"),
      ),
    );
    const ns = key();
    await run(
      "update users set password=? where id=?",
      ns +
        "." +
        (await derive(passwordInput(b.password), ns, 64)).toString("hex"),
      u,
    );
    await run("delete from sessions where uid=? and token!=?", u, digest(auth(req)));
    for (const s of sockets)
      if (s.uid === u && s.token !== digest(auth(req))) s.close();
    return {};
  }
  if (a === "createSpace") {
    const name = str(b.name, 72);
    const id = await db.transaction(async (tx) => {
      const spaceId = await tx.insert(
        "insert into spaces(name,owner,invite) values(?,?,?)",
        name,
        u,
        key().slice(0, 24),
      );
      await tx.run("insert into members values(?,?,'Administrator')", spaceId, u);
      await tx.run("insert into rooms(space,name,kind) values(?,'general','text')", spaceId);
      return spaceId;
    });
    return { id };
  }
  if (a === "join") {
    const sp = await one("select * from spaces where invite=?", str(b.invite, 100));
    demand(
      sp && !await one("select 1 from bans where space=? and uid=?", sp.id, u),
      "Poziv nije dostupan.",
      404,
    );
    await run("insert or ignore into members(space,uid) values(?,?)", sp.id, u);
    return { id: sp.id };
  }
  if (
    ["channel", "members", "manage", "audit", "rename", "deleteSpace"].includes(
      a,
    )
  ) {
    const m = await member(b.space, u);
    demand(m);
    const owner = (await one("select owner from spaces where id=?", b.space)).owner;
    if (a === "members") {
      const rows = await all(
        "select u.id,u.username,u.name,u.status,u.custom,m.role from members m join users u on u.id=m.uid where space=?",
        b.space,
      );
      const out = [];
      for (const p of rows) {
        out.push({
          ...p,
          badge: await policy.assigned(b.space, p.id),
          online: p.status !== "Invisible" && [...sockets].some((s) => s.uid === p.id),
        });
      }
      return out;
    }
    demand(m.role !== "Member");
    if (a === "audit")
      return await all(
        "select * from audit where space=? order by id desc limit 100",
        b.space,
      );
    if (a === "channel") {
      demand(["text", "voice", "announcement"].includes(b.kind));
      await run(
        "insert into rooms(space,name,kind,topic,restricted) values(?,?,?,?,?)",
        b.space,
        str(b.name, 60),
        b.kind,
        str(b.topic || "", 180, 0),
        b.restricted ? 1 : 0,
      );
    }
    if (a === "rename" || a === "deleteSpace") {
      demand(owner === u);
      if (a === "rename")
        await run("update spaces set name=? where id=?", str(b.name, 72), b.space);
      else await run("delete from spaces where id=?", b.space);
    }
    if (a === "manage") {
      demand(b.target !== owner && b.target !== u);
      const target = await member(b.space, b.target);
      demand(owner === u || target?.role === "Member");
      if (["Member", "Moderator", "Administrator"].includes(b.op)) {
        demand(owner === u);
        await run(
          "update members set role=? where space=? and uid=?",
          b.op,
          b.space,
          b.target,
        );
      } else if (b.op === "unban")
        await run("delete from bans where space=? and uid=?", b.space, b.target);
      else {
        demand(["kick", "ban"].includes(b.op));
        if (b.op === "ban")
          await run("insert or ignore into bans values(?,?)", b.space, b.target);
        await run("delete from members where space=? and uid=?", b.space, b.target);
      }
      await run(
        "insert into audit(space,uid,action,time) values(?,?,?,?)",
        b.space,
        u,
        b.op + " #" + b.target,
        Date.now(),
      );
      for (const s of sockets)
        if (s.uid === b.target && s.voice && !(await roomFor(s.voice, b.target)))
          s.close();
      await update([b.target]);
    }
    const spaceMembers = await all("select uid from members where space=?", b.space);
    await update(spaceMembers.map((p) => p.uid));
    return {};
  }
  if (["friend", "accept", "remove", "block", "unblock", "dm"].includes(a)) {
    const p = (await one(
      "select id from users where username=?",
      str(b.username, 30).toLowerCase(),
    ))?.id;
    demand(p && p !== u, "Korisnik nije dostupan.", 404);
    const relation = await one(
      "select * from friends where (sender=? and target=?) or (sender=? and target=?)",
      u,
      p,
      p,
      u,
    );
    if (a === "block") await run("insert or ignore into blocks values(?,?)", u, p);
    if (a === "remove" || a === "block")
      await run(
        "delete from friends where (sender=? and target=?) or (sender=? and target=?)",
        u,
        p,
        p,
        u,
      );
    if (a === "unblock")
      await run("delete from blocks where uid=? and target=?", u, p);
    if (["friend", "accept", "dm"].includes(a)) demand(!(await blocked(u, p)));
    if (a === "friend") {
      demand(
        (await one("select requests from preferences where uid=?", p))?.requests !== 0,
        "Zahtevi su isključeni.",
      );
      demand(!relation, "Zahtev već postoji.", 409);
      await run("insert into friends(sender,target) values(?,?)", u, p);
    }
    if (a === "accept") {
      demand(relation?.target === u);
      await run("update friends set accepted=1 where sender=? and target=?", p, u);
    }
    if (a === "dm") {
      demand(relation?.accepted);
      let id = (await one(
        "select a.room from participants a join participants b on a.room=b.room join rooms r on r.id=a.room where a.uid=? and b.uid=? and r.kind='dm'",
        u,
        p,
      ))?.room;
      if (!id) {
        id = await insert("insert into rooms(name,kind) values('','dm')");
        await run("insert into participants values(?,?),(?,?)", id, u, id, p);
      }
      await update([p, u]);
      return { id };
    }
    await update([p, u]);
    return {};
  }
  const r = await roomFor(b.room, u);
  demand(r);
  const notify = (event) =>
    push({ ...event, room: r.id }, (s) => roomFor(r.id, s.uid));
  if (a === "read") {
    await run(
      "insert into reads values(?,?,?) on conflict(room,uid) do update set last=max(last,excluded.last)",
      r.id,
      u,
      Number(b.last) || 0,
    );
    return {};
  }
  if (a === "history") {
    const rows = (await all(
      "select m.id,m.uid,m.body,m.parent,m.time,m.pinned,m.edited,m.file,m.mime,u.name,u.username from messages m join users u on u.id=m.uid where room=? and ((?=0 and not exists(select 1 from thread_posts t where t.msg=m.id)) or m.id=? or exists(select 1 from thread_posts t where t.msg=m.id and t.root=?)) and m.id<? and instr(lower(m.body),lower(?))>0 and m.pinned>=? order by m.id desc limit 50",
      r.id,
      Number(b.thread) || 0,
      Number(b.thread) || 0,
      Number(b.thread) || 0,
      Number(b.before) || Number.MAX_SAFE_INTEGER,
      str(b.search || "", 120, 0),
      b.pins ? 1 : 0,
    )).reverse();
    const out = [];
    for (const m of rows) {
      const thread = await one("select count(*) n from thread_posts where root=?", m.id);
      out.push({
        ...m,
        threadCount: thread?.n || 0,
        reactions: await all(
          "select emoji,count(*) n from reactions where msg=? group by emoji",
          m.id,
        ),
      });
    }
    return out;
  }
  if (a === "typing") {
    const typer = await one("select name from users where id=?", u);
    await notify({ type: "typing", uid: u, name: typer.name });
    return {};
  }
  if (a === "post") {
    demand(!r.space || r.canPost);
    demand(
      !r.space ||
        !await one(
          "select 1 from timeouts where space=? and uid=? and until>?",
          r.space,
          u,
          Date.now(),
        ),
      "Privremeno utišan nalog.",
    );
    limit("post" + u, 65);
    demand(r.kind !== "announcement" || r.role !== "Member");
    const body = str(b.body || "", 4000, 0);
    demand(body || b.file, "Poruka je prazna.", 400);
    if (b.parent)
      demand(
        await one("select id from messages where id=? and room=?", b.parent, r.id),
      );
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
      demand(
        bytes.length && bytes.length <= 5 * 1024 * 1024,
        "Najviše 5 MB.",
        400,
      );
      mime =
        bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216
            ? "image/jpeg"
            : bytes.subarray(0, 3).toString() === "GIF"
              ? "image/gif"
              : "application/octet-stream";
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
    await notify({
      type: "message",
      id,
      uid: u,
      mentions: [...body.matchAll(/@([a-z0-9_]+)/gi)]
        .map((m) => m[1].toLowerCase())
        .filter(
          (n) =>
            !["everyone", "administrator", "moderator", "member"].includes(n) ||
            r.role === "Administrator" ||
            r.role === "Moderator",
        ),
    });
    return { id };
  }
  const msg = await one(
    "select id,uid,pinned from messages where id=? and room=?",
    b.id,
    r.id,
  );
  demand(msg);
  if (a === "react") {
    const emoji = str(b.emoji, 10);
    if (
      !(await run(
        "delete from reactions where msg=? and uid=? and emoji=?",
        msg.id,
        u,
        emoji,
      )).changes
    )
      await run("insert into reactions values(?,?,?)", msg.id, u, emoji);
  } else if (a === "edit") {
    demand(msg.uid === u);
    await run(
      "update messages set body=?,edited=1 where id=?",
      str(b.body, 4000),
      msg.id,
    );
  } else if (a === "delete") {
    demand(msg.uid === u || ["Administrator", "Moderator"].includes(r.role));
    await run(
      "delete from messages where id=? or id in(select msg from thread_posts where root=?)",
      msg.id,
      msg.id,
    );
  } else if (a === "pin") {
    demand(!r.space || r.role !== "Member");
    await run("update messages set pinned=1-pinned where id=?", msg.id);
  } else demand(false, "Nepoznata akcija.", 404);
  await notify({ type: "changed" });
  return {};
}
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
const server = http.createServer(async (req, res) => {
  try {
    const bindHost = process.env.HOST || "127.0.0.1";
    if (["localhost", "127.0.0.1"].includes(bindHost)) {
      const host = new URL("http://" + req.headers.host).hostname;
      demand(
        [
          "localhost",
          "127.0.0.1",
          ...(process.env.SFF_PUBLIC_HOST ? [process.env.SFF_PUBLIC_HOST] : []),
        ].includes(host),
      );
    }
    if (req.headers.origin)
      demand(new URL(req.headers.origin).host === req.headers.host);
    const path = new URL(req.url, "http://localhost").pathname;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    const cookie = auth(req),
      u = cookie ? await session(digest(cookie)) : null;
    if (req.method === "GET" && path === "/health") {
      await one("select 1 as ok");
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ ok: true, database: db.remote ? "turso" : "local" }));
    }
    if (req.method === "POST" && path.startsWith("/api/")) {
      demand(
        req.headers["content-type"] === "application/json",
        "JSON je obavezan.",
        415,
      );
      if (!u)
        demand(
          ["register", "login", "capabilities", "forgot", "reset"].includes(
            path.slice(5),
          ),
          "Prijavi se.",
          401,
        );
      let chunks = [],
        n = 0;
      for await (const c of req) {
        n += c.length;
        demand(n < 7.1e6, "Prevelik fajl.", 413);
        chunks.push(c);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString());
      const result = await action(path.slice(5), data, u, res, req);
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(result));
    }
    if (path.startsWith("/art/")) {
      const [, , scope, raw, slot] = path.split("/"),
        id = Number(raw);
      demand(
        u &&
          (await state(u)).art.some(
            (a) => a.scope === scope && a.id === id && a.slot === slot,
          ),
      );
      const item = await one(
        "select bytes,mime from artwork where scope=? and id=? and slot=?",
        scope,
        id,
        slot,
      );
      res.setHeader("Content-Type", item.mime);
      return res.end(item.bytes);
    }
    if (path.startsWith("/media/")) {
      const id = Number(path.slice(7)),
        m = await one("select room,file,mime from messages where id=?", id);
      demand(u && m?.file && (await roomFor(m.room, u)));
      res.setHeader("Content-Type", m.mime);
      res.setHeader(
        "Content-Disposition",
        (/^(image\/|audio\/|video\/)/.test(m.mime) ? "inline" : "attachment") +
          "; filename*=UTF-8''" +
          encodeURIComponent(m.file),
      );
      const data = (await one("select bytes from messages where id=?", id)).bytes;
      const size = data.length;
      res.setHeader("Accept-Ranges", "bytes");
      const header = req.headers.range;
      if (header) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(header);
        demand(match && (match[1] || match[2]), "Neispravan raspon.", 416);
        let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        let end = match[2] && match[1] ? Math.min(size - 1, Number(match[2])) : size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
          res.statusCode = 416;
          res.setHeader("Content-Range", "bytes */" + size);
          return res.end();
        }
        res.statusCode = 206;
        res.setHeader("Content-Range", "bytes " + start + "-" + end + "/" + size);
        res.setHeader("Content-Length", String(end - start + 1));
        return res.end(data.subarray(start, end + 1));
      }
      res.setHeader("Content-Length", String(size));
      return res.end(data);
    }
    const f = path === "/" ? "index.html" : path.slice(1);
    demand(
      /^[a-zA-Z0-9._-]+$/.test(f) && types[extname(f)],
      "Nije pronađeno.",
      404,
    );
    res.setHeader("Content-Type", types[extname(f)]);
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'",
    );
    res.end(readFileSync(resolve(root, "../client", f)));
  } catch (e) {
    if (process.env.SFF_DEBUG === "1") console.error("SFF request error:", e);
    res.statusCode =
      e.status || ((e.code || "").includes("SQLITE") ? 409 : 400);
    res.end(
      JSON.stringify({
        error: e.status
          ? e.message
          : "Zahtev nije uspeo. Proveri podatke ili pokušaj drugo ime.",
      }),
    );
  }
});
server.on("upgrade", async (req, socket, head) => {
  const t = auth(req),
    token = t && digest(t),
    uid = token ? await session(token) : null;
  let valid = false;
  try {
    valid = new URL(req.headers.origin).host === req.headers.host;
  } catch {}
  if (!uid || !valid || req.url !== "/live") return socket.destroy();
  wss.handleUpgrade(req, socket, head, (s) => {
    s.uid = uid;
    s.token = token;
    s.peer = key().slice(0, 16);
    sockets.add(s);
    const leave = async () => {
      if (s.voice)
        await push(
          { type: "left", peer: s.peer },
          (p) => p.voice === s.voice && p !== s,
        );
      s.voice = null;
    };
    s.on("close", () => {
      void leave();
      sockets.delete(s);
    });
    s.on("error", () => s.terminate());
    s.on("message", async (raw) => {
      try {
        demand(await session(token));
        limit("ws" + uid, 600);
        const b = JSON.parse(raw);
        if (b.type === "leave") return await leave();
        const r = await roomFor(b.room, uid);
        demand(
          r?.kind === "voice" &&
            r.canVoice &&
            !await one(
              "select 1 from timeouts where space=? and uid=? and until>?",
              r.space,
              uid,
              Date.now(),
            ),
        );
        if (b.type === "voice") {
          await leave();
          const peers = [];
          for (const p of sockets) {
            if (p.voice === r.id && (await roomFor(r.id, p.uid))) peers.push(p);
          }
          demand(peers.length < 8, "Kanal je pun.");
          s.voice = r.id;
          s.send(
            JSON.stringify({
              type: "peers",
              peers: peers.map((p) => ({ peer: p.peer, uid: p.uid })),
              ice: JSON.parse(process.env.SFF_ICE || "[]"),
            }),
          );
        } else if (b.type === "signal") {
          demand(s.voice === r.id);
          await push(
            { type: "signal", peer: s.peer, uid, data: b.data },
            (p) =>
              p.voice === r.id && p.peer === b.peer && roomFor(r.id, p.uid),
          );
        }
      } catch (e) {
        s.send(JSON.stringify({ type: "error", error: e.message }));
      }
    });
  });
});
server.listen(
  Number(process.env.PORT || 4178),
  process.env.HOST || "127.0.0.1",
  () => console.log("SFF ready", server.address().port),
);
