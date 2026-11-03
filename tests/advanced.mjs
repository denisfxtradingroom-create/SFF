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
  assert.equal((await call(B, "history", { room: dm })).length, 0);
  assert.equal((await call(A, "history", { room: dm }))[0].body, "stara poruka");

  await call(A, "post", { room: dm, body: "nova poruka" });
  assert(!(await call(B, "hiddenChats")).some((x) => x.room === dm));
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

  console.log("SFF advanced chat/media checks passed");
} finally {
  server?.kill();
}
