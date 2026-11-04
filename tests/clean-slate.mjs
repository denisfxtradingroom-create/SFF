import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../backend/db.mjs";
import { extras } from "../backend/extras.mjs";
import { rolePolicy } from "../backend/roles.mjs";
import { socialWall } from "../backend/wall.mjs";
import { resetAccountDataOnce, RESET_ACCOUNT_TABLES } from "../backend/account-reset-once.mjs";

const old = Object.fromEntries(
  ["SFF_DATA", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "SFF_REQUIRE_DURABLE_DB"]
    .map((k) => [k, process.env[k]]),
);
let db;
try {
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.SFF_REQUIRE_DURABLE_DB;
  process.env.SFF_DATA = mkdtempSync(join(tmpdir(), "sff-clean-slate-"));
  db = await openDatabase();
  await db.exec(readFileSync(new URL("../backend/schema.sql", import.meta.url), "utf8"));
  const { all, one, run, insert } = db;
  const demand = (ok) => { if (!ok) throw Error("Denied"); };
  const blocked = () => false, roomFor = () => null, push = async () => {}, sockets = new Set();
  await rolePolicy({ db, one, all, run, demand, member: () => null, str: (x) => x });
  await extras({ db, one, all, run, insert, demand, str: (x) => x,
    limit: () => {}, blocked, roomFor, push, sockets });
  await socialWall({ db, one, all, run, insert, demand, blocked, limit: () => {}, push });
  
  assert.deepEqual(await resetAccountDataOnce(db, ""), { active: false });
  await assert.rejects(
    resetAccountDataOnce(db, "sff-reset-test-first"),
    /trajnu Turso bazu/,
  );
  await assert.rejects(
    resetAccountDataOnce(db, "invalid", { allowLocalTest: true }),
    /oznaka/,
  );

  await run("INSERT INTO users(id,username,email,password,name) VALUES(1,'prvi','prvi@test.invalid','salt.hash','Prvi Korisnik')");
  await run("INSERT INTO users(id,username,email,password,name) VALUES(2,'drugi','drugi@test.invalid','salt.hash','Drugi Korisnik')");
  await run("INSERT INTO sessions(token,uid,expires) VALUES('hashed-token',1,99999999)");
  await run("INSERT INTO friends(sender,target,accepted) VALUES(1,2,1)");
  await run("INSERT INTO spaces(id,name,owner) VALUES(1,'Test',1)");
  await run("INSERT INTO members(space,uid,role) VALUES(1,1,'Administrator')");
  await run("INSERT INTO rooms(id,space,name,kind) VALUES(1,1,'Test kanal','text')");
  await run("INSERT INTO participants(room,uid) VALUES(1,1)");
  await run("INSERT INTO messages(id,room,uid,body,time) VALUES(1,1,1,'tajna poruka',1)");
  await run("INSERT INTO reactions(msg,uid,emoji) VALUES(1,2,'👍')");
  await run("INSERT INTO reads(room,uid,last) VALUES(1,2,1)");
  await run("INSERT INTO wall_posts(id,uid,body,created) VALUES(1,1,'objava',1)");
  await run("INSERT INTO wall_comments(id,post,uid,body,created) VALUES(1,1,2,'komentar',1)");
  await run("INSERT INTO wall_likes(post,uid) VALUES(1,2)");
  await run("INSERT INTO roles(id,space,name,color,rank,canPost,canVoice) VALUES(1,1,'Test','#ffffff',1,1,1)");
  await run("INSERT INTO assignments(space,uid,role) VALUES(1,1,1)");
  await run("INSERT INTO preferences(uid,verified) VALUES(1,1)");
  await run("INSERT INTO artwork(scope,id,slot,mime,bytes) VALUES('user',1,'avatar','image/png',x'89504e47')");

  const marker = "sff-reset-test-first";
  const result = await resetAccountDataOnce(db, marker, { allowLocalTest: true });
  assert.equal(result.alreadyApplied, false);
  assert.equal(result.before.users, 2);
  assert.equal(result.before.messages, 1);
  assert.equal(result.before.wall_posts, 1);
  for (const table of RESET_ACCOUNT_TABLES) {
    assert.equal(Number((await one('SELECT COUNT(*) AS n FROM "'+table+'"')).n), 0, table);
  }
  assert.equal((await one("SELECT value FROM sff_admin_meta WHERE key='last_account_reset'")).value, marker);
  await run("INSERT INTO users(username,email,password,name) VALUES('novi','novi@test.invalid','new.hash','Novi Korisnik')");
  const repeated = await resetAccountDataOnce(db, marker, { allowLocalTest: true });
  assert.equal(repeated.alreadyApplied, true);
  assert.equal(Number((await one("SELECT COUNT(*) AS n FROM users")).n), 1,
    "A repeated deploy MUST NOT delete newly registered people.");
  db.native.close();

  // A completely new process opening the SAME database must also avoid wipe.
  db = await openDatabase();
  assert.equal((await resetAccountDataOnce(db, marker, { allowLocalTest: true })).alreadyApplied, true);
  assert.equal(Number((await db.one("SELECT COUNT(*) AS n FROM users")).n), 1);
  db.native.close();
  db = null;
  console.log("SFF clean slate: all account data deleted atomically; repeat deploys preserve new users.");
} finally {
  db?.native?.close();
  for (const [k, v] of Object.entries(old)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}
