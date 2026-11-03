import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
const dir = mkdtempSync(join(tmpdir(), "sff-test-")),
  entry = fileURLToPath(new URL("../backend/server.mjs", import.meta.url));
let server, origin;
async function boot() {
  server = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", SFF_DATA: dir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [log] = await once(server.stdout, "data");
  origin = "http://127.0.0.1:" + log.toString().trim().split(" ").at(-1);
}
const user = () => ({ cookie: "" }),
  A = user(),
  B = user();
async function call(w, a, b = {}, code = 200) {
  const res = await fetch(origin + "/api/" + a, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: w.cookie },
    body: JSON.stringify(b),
  });
  if (res.headers.has("set-cookie"))
    w.cookie = res.headers.get("set-cookie").split(";")[0];
  const v = await res.json();
  assert.equal(res.status, code, a + " " + JSON.stringify(v.error));
  return v;
}
async function ws(w) {
  const s = new WebSocket(origin.replace("http", "ws") + "/live", {
    headers: { Cookie: w.cookie, Origin: origin },
  });
  await once(s, "open");
  return s;
}
const wait = (s, type) =>
  new Promise((ok, no) => {
    const id = setTimeout(() => {
      s.off("message", listen);
      no(Error("timeout: " + type));
    }, 3000);
    function listen(raw) {
      const e = JSON.parse(raw);
      if (e.type === type) {
        clearTimeout(id);
        s.off("message", listen);
        ok(e);
      }
    }
    s.on("message", listen);
  });
try {
  await boot();
  for (const [w, n] of [
    [A, "alpha"],
    [B, "bravo"],
  ])
    await call(w, "register", {
      username: n,
      password: "test-long-password",
      passwordConfirm: "test-long-password",
      email: n + "@example.test",
      emailConfirm: n + "@example.test",
      firstName: n,
      lastName: "Test",
    });
  assert.equal((await call(A, "state")).me.name, "alpha Test");
  let sa = await ws(A),
    sb = await ws(B);
  await call(A, "friend", { username: "bravo" });
  await call(B, "accept", { username: "alpha" });
  const { id: dm } = await call(A, "dm", { username: "bravo" });
  const event = wait(sb, "message");
  const { id: msg } = await call(A, "post", {
    room: dm,
    body: "Privatna poruka",
  });
  assert.equal((await event).id, msg);
  assert.equal(
    (await call(B, "history", { room: dm }))[0].body,
    "Privatna poruka",
  );
  const { id: space } = await call(A, "createSpace", { name: "Studio" });
  const invite = (await call(A, "state")).spaces[0].invite;
  await call(B, "join", { invite });
  await call(B, "channel", { space, name: "x", kind: "text" }, 403);
  await call(A, "channel", {
    space,
    name: "staff",
    kind: "text",
    restricted: true,
  });
  await call(A, "channel", { space, name: "Glas", kind: "voice" });
  const rooms = (await call(A, "state")).rooms;
  const staff = rooms.find((x) => x.name === "staff").id,
    voice = rooms.find((x) => x.kind === "voice").id;
  await call(B, "history", { room: staff }, 403);
  const { id: file } = await call(A, "post", {
    room: dm,
    file: "note.txt",
    data: Buffer.from("attachment").toString("base64"),
  });
  assert.equal(
    await (
      await fetch(origin + "/media/" + file, { headers: { Cookie: B.cookie } })
    ).text(),
    "attachment",
  );
  assert.equal((await fetch(origin + "/media/" + file)).status, 403);
  await call(B, "edit", { room: dm, id: msg, body: "invalid" }, 403);
  await call(A, "edit", { room: dm, id: msg, body: "updated" });
  await call(B, "react", { room: dm, id: msg, emoji: "🔥" });
  await call(B, "pin", { room: dm, id: msg });
  assert.equal(
    (await call(B, "history", { room: dm, pins: true }))[0].reactions[0].n,
    1,
  );
  const { id: root } = await call(A, "post", { room: dm, body: "Tema" });
  await call(B, "post", { room: dm, thread: root, body: "Detalj" });
  assert.equal(
    (await call(B, "history", { room: dm, thread: root })).length,
    2,
  );
  assert(
    !(await call(A, "history", { room: dm })).some((m) => m.body === "Detalj"),
  );
  const general = rooms.find((r) => r.name === "general").id;
  await call(A, "newRole", {
    space,
    name: "Reader",
    color: "#ff6755",
    rank: 2,
    canPost: false,
    canVoice: true,
  });
  const role = (await call(A, "roles", { space }))[0].id;
  await call(A, "assignRole", { space, target: 2, role });
  await call(B, "post", { room: general, body: "ne" }, 403);
  await call(A, "override", {
    space,
    role,
    room: general,
    visible: true,
    canVoice: false,
    canPost: true,
  });
  await call(B, "post", { room: general, body: "dozvoljeno" });
  await call(B, "override", { space, role, room: general, visible: true }, 403);
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuoAAAAASUVORK5CYII=";
  const image = await call(A, "post", {
    room: dm,
    file: "pixel.png",
    data: png,
  });
  assert.equal(
    (
      await fetch(origin + "/media/" + image.id, {
        headers: { Cookie: B.cookie },
      })
    ).headers.get("Content-Type"),
    "image/png",
  );
  await call(A, "art", { scope: "user", slot: "avatar", data: png });
  assert.equal(
    (
      await fetch(origin + "/art/user/1/avatar", {
        headers: { Cookie: B.cookie },
      })
    ).status,
    200,
  );
  await call(B, "alerts", { scope: "r" + dm, policy: "mentions" });
  assert.equal((await call(B, "state")).alerts[0].policy, "mentions");
  const C = user();
  await call(C, "register", {
    username: "charlie",
    email: "c@example.test",
    emailConfirm: "c@example.test",
    password: "test-long-password",
    passwordConfirm: "test-long-password",
    firstName: "Charlie",
    lastName: "Test",
  });
  await call(A, "friend", { username: "charlie" });
  await call(C, "accept", { username: "alpha" });
  const group = await call(A, "group", { name: "Tim", names: "bravo,charlie" });
  await call(B, "post", { room: group.id, body: "Grupna poruka" });
  assert.equal(
    (await call(C, "history", { room: group.id }))[0].body,
    "Grupna poruka",
  );
  const p1 = wait(sa, "peers");
  sa.send(JSON.stringify({ type: "voice", room: voice }));
  await p1;
  const p2 = wait(sb, "peers");
  sb.send(JSON.stringify({ type: "voice", room: voice }));
  const peers = (await p2).peers;
  assert.equal(peers.length, 1);
  const sig = wait(sa, "signal");
  sb.send(
    JSON.stringify({
      type: "signal",
      room: voice,
      peer: peers[0].peer,
      data: { test: true },
    }),
  );
  assert.equal((await sig).data.test, true);
  sb.close();
  await once(sb, "close");
  sb = await ws(B);
  const after = wait(sb, "message");
  await call(A, "post", { room: dm, body: "Ponovo povezano" });
  await after;
  await call(B, "block", { username: "alpha" });
  await call(B, "history", { room: dm }, 403);
  assert.equal(
    (await fetch(origin + "/media/" + file, { headers: { Cookie: A.cookie } }))
      .status,
    403,
  );
  await call(B, "unblock", { username: "alpha" });
  const old = { cookie: A.cookie };
  await call(A, "logout");
  await call(old, "state", {}, 401);
  await call(A, "login", { username: "alpha", password: "test-long-password" });
  sb.close();
  const stop = once(server, "exit");
  server.kill();
  await stop;
  await boot();
  assert((await call(A, "history", { room: dm })).some((m) => m.id === msg));
  assert((await call(B, "state")).spaces.some((s) => s.id === space));
  console.log(
    "PASS: two sessions, friends, DM, WebSocket delivery, community, channels, permissions, edit/reaction/pin, protected file, voice signaling, reconnect, block, logout/login, durable restart.",
  );
} finally {
  server?.kill();
}
