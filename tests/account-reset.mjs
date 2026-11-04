import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../backend/db.mjs";
import { resetAppDataOnce } from "../backend/account-reset.mjs";

process.env.TURSO_DATABASE_URL = "";
process.env.TURSO_AUTH_TOKEN = "";
process.env.SFF_REQUIRE_DURABLE_DB = "0";
process.env.SFF_DATA = mkdtempSync(join(tmpdir(), "sff-account-reset-"));
const db = await openDatabase();
await db.exec(readFileSync(fileURLToPath(new URL("../backend/schema.sql", import.meta.url)), "utf8"));
await db.exec(
  "CREATE TABLE wall_posts(id INTEGER PRIMARY KEY,uid INTEGER REFERENCES users,body TEXT,created INTEGER);" +
  "CREATE TABLE wall_likes(post INTEGER REFERENCES wall_posts,uid INTEGER REFERENCES users,PRIMARY KEY(post,uid));"
);
for (const [id, name] of [[1, "first"], [2, "second"]]) {
  await db.run("insert into users(id,username,email,password,name) values(?,?,?,?,?)",
    id, name, name + "@example.test", "salt.hash", "Same Display Name");
  await db.run("insert into sessions values(?,?,?)", "session-" + id, id, Date.now() + 100000);
}
await db.run("insert into spaces(id,name,owner,invite) values(7,'Studio',1,'invite')");
await db.run("insert into members(space,uid,role) values(7,1,'Administrator')");
await db.run("insert into rooms(id,space,name,kind) values(9,7,'General','text')");
await db.run("insert into participants(room,uid) values(9,1)");
await db.run("insert into messages(id,room,uid,body,time) values(11,9,1,'hello',1)");
await db.run("insert into wall_posts(id,uid,body,created) values(15,1,'hello',1)");
await db.run("insert into wall_likes(post,uid) values(15,2)");
await db.run("insert into friends(sender,target) values(1,2)");
const first = await resetAppDataOnce(db, "SFF_TEST_RESET_2026");
assert.deepEqual(first, { alreadyApplied: false, removedUsers: 2 });
for (const table of ["users","sessions","spaces","members","rooms","participants",
  "messages","wall_posts","wall_likes","friends"]) {
  assert.equal(Number((await db.one('select count(*) as n from "' + table + '"')).n),0,table);
}
await db.run("insert into users(id,username,email,password,name) values(1,'fresh','fresh@example.test','x','Fresh')");
const repeated = await resetAppDataOnce(db, "SFF_TEST_RESET_2026");
assert.equal(repeated.alreadyApplied, true, "Reset must NEVER delete newly registered users");
assert.equal(Number((await db.one("select count(*) as n from users")).n),1);
await db.exec("CREATE TABLE unexpected_legacy_usernames(id INTEGER PRIMARY KEY,name TEXT)");
await assert.rejects(resetAppDataOnce(db, "SFF_TEST_RESET_OTHER"), /nepoznate tabele/);
assert.equal(Number((await db.one("select count(*) as n from users")).n),1,
  "Unknown-table failure must be transactional and preserve user data");
console.log("PASS: one-shot app reset, cascade cleanup, durable receipt, unknown-table rollback");
