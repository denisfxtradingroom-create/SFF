import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "sff-advanced-"));
const entry = fileURLToPath(new URL("../backend/server.mjs", import.meta.url));
let server;
let origin;

async function boot() {
  server = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", SFF_DATA: dir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [log] = await once(server.stdout, "data");
  origin = "http://127.0.0.1:" + log.toString().trim().split(" ").at(-1);
}

const account = () => ({ cookie: "" });
const A = account();
const B = account();

async function call(w, action, body = {}, status = 200) {
  const response = await fetch(origin + "/api/" + action, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: w.cookie },
    body: JSON.stringify(body),
  });
  if (response.headers.has("set-cookie"))
    w.cookie = response.headers.get("set-cookie").split(";")[0];
  const result = await response.json();
  assert.equal(response.status, status, action + " " + JSON.stringify(result));
  return result;
}

try {
  await boot();
  for (const [w, username] of [[A, "denis"], [B, "ana"]]) {
    await call(w, "register", {
      username,
      email: username + "@example.test",
      emailConfirm: username + "@example.test",
      password: "advanced-test-password",
      passwordConfirm: "advanced-test-password",
      firstName: username,
      lastName: "Test",
    });
  }

  const invalid = account();
  const duplicate = {
    username: "newuser", email: "newuser@example.test",
    emailConfirm: "newuser@example.test",
    password: "advanced-test-password",
    passwordConfirm: "advanced-test-password",
    firstName: "denis", lastName: "Test",
  };
  await call(invalid, "register", duplicate, 409);
  await call(invalid, "register", { ...duplicate, username: "denis",
    firstName: "Another", lastName: "Person" }, 409);

  // A previously saved signup can be safely resumed, but only by the owner.
  // This is important when an email provider fails after the user is saved.
  const retry = account();
  const sameAccount = await call(retry, "register", {
    username: "denis", email: "denis@example.test",
    emailConfirm: "denis@example.test",
    password: "advanced-test-password",
    passwordConfirm: "advanced-test-password",
    firstName: "denis", lastName: "Test",
  });
  assert.equal(sameAccount.me.id, (await call(A, "state")).me.id);
  assert.equal((await call(retry, "state")).me.username, "denis");
  assert.equal((await call(A, "state")).me.username, "denis");
  await call(account(), "register", {
    username: "denis", email: "denis@example.test",
    emailConfirm: "denis@example.test",
    password: "wrong-password",
    passwordConfirm: "wrong-password",
    firstName: "denis", lastName: "Test",
  }, 409);
  await call(account(), "register", {
    username: "denis", email: "not-denis@example.test",
    emailConfirm: "not-denis@example.test",
    password: "advanced-test-password",
    passwordConfirm: "advanced-test-password",
    firstName: "denis", lastName: "Test",
  }, 409);
  await call(B, "profile", { name: "denis Test", about: "", status: "Online", custom: "" }, 409);
  const loginBody = JSON.stringify({ username: "denis",
    password: "advanced-test-password", remember: false });
  const temporary = await fetch(origin + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: loginBody,
  });
  assert.equal(temporary.status, 200);
  assert(!temporary.headers.get("set-cookie")?.includes("Max-Age="));
  const permanent = await fetch(origin + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "denis", password: "advanced-test-password", remember: true }),
  });
  assert.equal(permanent.status, 200);
  assert(permanent.headers.get("set-cookie")?.includes("Max-Age=7776000"));

  await call(A, "friend", { username: "ana" });
  await call(B, "accept", { username: "denis" });
  const { id: dm } = await call(A, "dm", { username: "ana" });

  await call(A, "post", { room: dm, body: "stara poruka" });
  assert.equal((await call(B, "history", { room: dm })).length, 1);

  const info = await call(B, "chatInfo", { room: dm });
  assert.equal(info.kind, "dm");
  assert.equal(info.participants[0].username, "denis");
  assert.equal((await call(B, "userProfile", { id: info.participants[0].id })).username, "denis");

  await call(B, "deleteChat", { room: dm });
  assert((await call(B, "hiddenChats")).some((x) => x.room === dm));
  assert(!(await call(B, "state")).rooms.some((x) => x.id === dm));
  assert.equal((await call(B, "history", { room: dm })).length, 0);
  assert.equal((await call(A, "history", { room: dm }))[0].body, "stara poruka");

  await call(A, "post", { room: dm, body: "nova poruka" });
  assert(!(await call(B, "hiddenChats")).some((x) => x.room === dm));
  assert((await call(B, "state")).rooms.some((x) => x.id === dm));
  const after = await call(B, "history", { room: dm });
  assert.deepEqual(after.map((m) => m.body), ["nova poruka"]);

  const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(32, 1)]);
  const audio = await call(A, "post", {
    room: dm,
    file: "voice.mp3",
    data: mp3.toString("base64"),
  });
  assert.equal(
    (await fetch(origin + "/media/" + audio.id, { headers: { Cookie: B.cookie } })).headers.get("Content-Type"),
    "audio/mpeg",
  );

  const mp4 = Buffer.alloc(32, 0);
  mp4.write("ftyp", 4, "ascii");
  const video = await call(A, "post", {
    room: dm,
    file: "clip.mp4",
    data: mp4.toString("base64"),
  });
  assert.equal(
    (await fetch(origin + "/media/" + video.id, { headers: { Cookie: B.cookie } })).headers.get("Content-Type"),
    "video/mp4",
  );

  const webm = Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(20),
  ]);
  const voice = await call(A, "post", {
    room: dm, file: "glasovna.webm", data: webm.toString("base64"),
  });
  const part = await fetch(origin + "/media/" + voice.id, {
    headers: { Cookie: B.cookie, Range: "bytes=0-3" },
  });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("Content-Type"), "audio/webm");
  assert.equal(part.headers.get("Content-Range"), "bytes 0-3/" + webm.length);
  assert(part.headers.get("Content-Disposition").startsWith("inline"));
  assert.equal((await part.arrayBuffer()).byteLength, 4);

  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuoAAAAASUVORK5CYII=";
  await call(A, "art", { scope: "user", slot: "avatar", data: png });
  const profile = await call(B, "userProfile", { username: "denis" });
  assert.equal(profile.avatar, true);
  assert.equal(profile.banner, false);
  assert.equal((await fetch(origin + "/art/user/1/avatar", {
    headers: { Cookie: B.cookie },
  })).status, 200);

  console.log("SFF 0.5 advanced tests passed: unique names, remember me, chat delete, profiles, voice MIME/ranges");
} finally {
  server?.kill();
}
