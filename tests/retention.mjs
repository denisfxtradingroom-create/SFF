import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../backend/db.mjs";
import { initRetention, purgeExpiredContent, RETENTION_MS } from "../backend/retention.mjs";
import { addMessageMetadata } from "../backend/message-metadata.mjs";

const dir = mkdtempSync(join(tmpdir(), "sff-retention-"));
process.env.SFF_DATA = dir;
process.env.TURSO_DATABASE_URL = "";
process.env.TURSO_AUTH_TOKEN = "";
process.env.SFF_REQUIRE_DURABLE_DB = "0";
const db = await openDatabase();
await db.exec(readFileSync(new URL("../backend/schema.sql", import.meta.url), "utf8"));
await db.exec(`CREATE TABLE IF NOT EXISTS wall_posts(
  id INTEGER PRIMARY KEY, uid INTEGER REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL,image_mime TEXT,image_bytes BLOB);
CREATE TABLE IF NOT EXISTS wall_likes(
  post INTEGER REFERENCES wall_posts(id) ON DELETE CASCADE,
  uid INTEGER REFERENCES users(id),PRIMARY KEY(post,uid));
CREATE TABLE IF NOT EXISTS wall_comments(
  id INTEGER PRIMARY KEY,post INTEGER REFERENCES wall_posts(id) ON DELETE CASCADE,
  uid INTEGER REFERENCES users(id),body TEXT,created INTEGER);`);
await initRetention(db);
const now = Date.now();
const old = now - RETENTION_MS - 86400000;
const fresh = now - RETENTION_MS + 86400000;
for (const [uid,name] of [[1,"alice"],[2,"bob"]]) {
  await db.run("insert into users(id,username,email,password,name) values(?,?,?,?,?)",
    uid,name,name+"@example.test","test-hash",name);
}
await db.run("insert into sessions(token,uid,expires) values('session-1',1,?)",now+86400000);
await db.run("insert into rooms(id,kind,name) values(1,'dm','')");
await db.run("insert into participants(room,uid) values(1,1),(1,2)");
const file=Buffer.from("sff-test-blob");
const messages=[
  [10,1,"",old,"old.jpg","image/jpeg",file,1],
  [11,1,"Opis slike ostaje.",old,"old-video.mp4","video/mp4",file,0],
  [12,2,"Nova slika",fresh,"new.png","image/png",file,0],
  [13,1,"Stara tekstualna poruka se ne briše",old,null,null,null,0],
  [14,1,"Sasvim nova poruka",now,null,null,null,0],
  [15,2,"Odgovor na poruku",now,null,null,null,0]
];
for (const item of messages)
  await db.run(
    "insert into messages(id,room,uid,body,time,file,mime,bytes,pinned) values(?,1,?,?,?,?,?,?,?)",
    ...item
  );
await db.run("insert into reactions(msg,uid,emoji) values(11,2,'❤️'),(11,1,'❤️')");
await db.run("insert into thread_posts(msg,root) values(15,11)");
for (const [id,created] of [[100,old],[101,fresh]]) {
  await db.run("insert into wall_posts(id,uid,body,created,image_mime,image_bytes) values(?,1,'test',?,'image/png',?)",
    id,created,file);
  await db.run("insert into wall_likes(post,uid) values(?,2)",id);
  await db.run("insert into wall_comments(post,uid,body,created) values(?,2,'komentar',?)",id,created);
}
const stats = await purgeExpiredContent(db,{now,batchSize:1,maxBatches:8});
assert.deepEqual(stats,{media:2,posts:1});
const oldOnly=await db.one("select body,file,mime,bytes,pinned from messages where id=10");
assert.equal(oldOnly.file,null);
assert.equal(oldOnly.mime,null);
assert.equal(oldOnly.bytes,null);
assert.equal(oldOnly.pinned,1);
assert.match(oldOnly.body,/uklonjen nakon 7 dana/i);
const described=await db.one("select body,file,bytes from messages where id=11");
assert.equal(described.body,"Opis slike ostaje.");
assert.equal(described.file,null);
assert.equal(described.bytes,null);
assert.equal((await db.one("select file from messages where id=12")).file,"new.png");
assert.equal((await db.one("select body from messages where id=13")).body,
  "Stara tekstualna poruka se ne briše");
assert.equal((await db.one("select count(*) n from reactions where msg=11")).n,2);
assert.equal((await db.one("select count(*) n from wall_posts where id=100")).n,0);
assert.equal((await db.one("select count(*) n from wall_likes where post=100")).n,0);
assert.equal((await db.one("select count(*) n from wall_comments where post=100")).n,0);
assert.equal((await db.one("select count(*) n from wall_posts where id=101")).n,1);
assert.equal((await db.one("select count(*) n from wall_likes where post=101")).n,1);
assert.equal((await db.one("select count(*) n from users")).n,2);
assert.equal((await db.one("select count(*) n from sessions")).n,1);
assert.deepEqual(await purgeExpiredContent(db,{now}),{media:0,posts:0},
  "Cleanup must be idempotent and must not write unchanged rows");
const rows=await db.all("select id,body from messages where id in (11,12) order by id");
let extraQueries=0;
const read=(sql,...args)=>{extraQueries++;return db.all(sql,...args);};
const enriched=await addMessageMetadata(rows,read);
assert.equal(extraQueries,2,"A page of messages requires exactly two extra DB queries");
assert.equal(enriched[0].threadCount,1);
assert.deepEqual(enriched[0].reactions,[{emoji:"❤️",n:2}]);
assert.deepEqual(enriched[1].reactions,[]);
assert.equal((await addMessageMetadata(rows,db.all,15))[0].threadCount,0);
assert.deepEqual(await addMessageMetadata([],read),[]);
assert.equal(extraQueries,2,"Empty pages must not read the database");
console.log("SFF retention: expired media blobs and wall posts removed; text, users, sessions and new media preserved; message metadata batched PASS");
