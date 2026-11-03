import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, wrapRemote } from "../backend/db.mjs";

const keys = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "SFF_REQUIRE_DURABLE_DB", "SFF_DATA"];
const old = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
try {
  for (const key of keys) delete process.env[key];
  process.env.TURSO_AUTH_TOKEN = "test-token";
  await assert.rejects(openDatabase(), /Turso nije potpuno podešen/);
  delete process.env.TURSO_AUTH_TOKEN;

  process.env.TURSO_DATABASE_URL = "libsql://example.turso.io";
  await assert.rejects(openDatabase(), /Turso nije potpuno podešen/);
  process.env.TURSO_AUTH_TOKEN = "test-token";
  process.env.TURSO_DATABASE_URL = "file:temporary.sqlite";
  await assert.rejects(openDatabase(), /libsql/);

  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.SFF_REQUIRE_DURABLE_DB = "1";
  await assert.rejects(openDatabase(), /Trajna Turso baza je obavezna/);

  delete process.env.SFF_REQUIRE_DURABLE_DB;
  process.env.SFF_DATA = mkdtempSync(join(tmpdir(), "sff-db-guard-"));
  let local = await openDatabase();
  assert.equal(local.remote, false);
  await local.exec("CREATE TABLE durable_test(id INTEGER PRIMARY KEY, body TEXT)");
  const id = await local.insert("INSERT INTO durable_test(body) VALUES(?)", "test");
  assert.equal(id, 1);
  local.native.close();
  local = await openDatabase();
  assert.equal((await local.one("SELECT body FROM durable_test WHERE id=?", id)).body, "test");
  local.native.close();

  // Exercise the actual SFF remote adapter interface without Turso credentials
  // by implementing its execute/batch/transaction protocol atop node:sqlite.
  const native = new DatabaseSync(":memory:");
  const execute = async ({sql, args = []}) => {
    const stmt = native.prepare(sql);
    if (stmt.isReader) return {rows: stmt.all(...args)};
    const result = stmt.run(...args);
    return {rows:[], rowsAffected: Number(result.changes),
      lastInsertRowid: result.lastInsertRowid};
  };
  const fakeClient = {
    execute,
    batch: async (stmts) => {
      native.exec("BEGIN IMMEDIATE");
      try {
        const outputs = [];
        for (const stmt of stmts) outputs.push(await execute(stmt));
        native.exec("COMMIT");
        return outputs;
      } catch (e) {
        native.exec("ROLLBACK");
        throw e;
      }
    },
    transaction: async () => {
      native.exec("BEGIN IMMEDIATE");
      return {
        execute,
        commit: async () => native.exec("COMMIT"),
        rollback: async () => native.exec("ROLLBACK"),
        close: () => {},
      };
    },
  };
  const remote = wrapRemote(fakeClient);
  assert.equal(remote.remote, true);
  await remote.exec("PRAGMA foreign_keys=ON; CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)");
  const first = await remote.insert("INSERT INTO t(v) VALUES(?)", "first");
  assert.equal((await remote.one("SELECT v FROM t WHERE id=?", first)).v, "first");
  await remote.transaction(async (tx) => {
    await tx.insert("INSERT INTO t(v) VALUES(?)", "second");
    const rows = await tx.all("SELECT v FROM t ORDER BY id");
    assert.deepEqual(rows.map((r) => r.v), ["first", "second"]);
  });
  assert.equal((await remote.all("SELECT * FROM t")).length, 2);
  await assert.rejects(remote.transaction(async (tx) => {
    await tx.run("INSERT INTO t(v) VALUES(?)", "rolled-back");
    throw new Error("rollback-test");
  }), /rollback-test/);
  assert.equal((await remote.all("SELECT * FROM t")).length, 2);
  native.close();
  console.log("SFF: Turso configuration guard and libSQL adapter tests OK");
} finally {
  for (const key of keys) {
    if (old[key] === undefined) delete process.env[key];
    else process.env[key] = old[key];
  }
}
