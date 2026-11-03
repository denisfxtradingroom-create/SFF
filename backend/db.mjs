import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const normalizeValue = (value) => {
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString();
  }
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  return value;
};

const normalizeRow = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k] = normalizeValue(v);
  return out;
};

function cleanStatements(sql) {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^PRAGMA\b/i.test(s));
}

export function wrapRemote(client) {
  const execute = async (sql, args = []) => client.execute({ sql, args });
  const all = async (sql, ...args) => {
    const result = await execute(sql, args);
    return result.rows.map(normalizeRow);
  };
  const one = async (sql, ...args) => {
    const result = await execute(sql, args);
    return normalizeRow(result.rows[0]);
  };
  const run = async (sql, ...args) => {
    const result = await execute(sql, args);
    return {
      changes: Number(result.rowsAffected || 0),
      lastInsertRowid:
        result.lastInsertRowid == null ? undefined : Number(result.lastInsertRowid),
    };
  };
  const insert = async (sql, ...args) => {
    const result = await run(sql, ...args);
    if (result.lastInsertRowid == null) throw new Error("Insert nije vratio ID.");
    return result.lastInsertRowid;
  };
  const exec = async (sql) => {
    const statements = cleanStatements(sql);
    if (!statements.length) return;
    await client.batch(
      statements.map((statement) => ({ sql: statement, args: [] })),
      "write",
    );
  };
  const transaction = async (fn) => {
    const tx = await client.transaction("write");
    const txdb = wrapRemote(tx);
    try {
      const result = await fn(txdb);
      await tx.commit();
      return result;
    } catch (error) {
      try {
        await tx.rollback();
      } catch {}
      throw error;
    } finally {
      try {
        await tx.close();
      } catch {}
    }
  };
  return { client, execute, all, one, run, insert, exec, transaction, remote: true };
}

function wrapLocal(native) {
  const all = async (sql, ...args) => native.prepare(sql).all(...args).map(normalizeRow);
  const one = async (sql, ...args) => normalizeRow(native.prepare(sql).get(...args));
  const run = async (sql, ...args) => {
    const result = native.prepare(sql).run(...args);
    return {
      changes: Number(result.changes || 0),
      lastInsertRowid:
        result.lastInsertRowid == null ? undefined : Number(result.lastInsertRowid),
    };
  };
  const insert = async (sql, ...args) => {
    const result = await run(sql, ...args);
    if (result.lastInsertRowid == null) throw new Error("Insert nije vratio ID.");
    return result.lastInsertRowid;
  };
  const exec = async (sql) => native.exec(sql);
  const transaction = async (fn) => {
    native.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn({ all, one, run, insert, exec });
      native.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        native.exec("ROLLBACK");
      } catch {}
      throw error;
    }
  };
  return { native, all, one, run, insert, exec, transaction, remote: false };
}

export async function openDatabase() {
  if (process.env.TURSO_DATABASE_URL) {
    if (!process.env.TURSO_AUTH_TOKEN) {
      throw new Error("TURSO_AUTH_TOKEN je obavezan kada je TURSO_DATABASE_URL podešen.");
    }
    const { createClient } = await import("@tursodatabase/serverless/compat");
    return wrapRemote(
      createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN,
      }),
    );
  }

  const dir = resolve(process.env.SFF_DATA || "sff-data");
  mkdirSync(dir, { recursive: true });
  const native = new DatabaseSync(resolve(dir, "sff.sqlite"));
  return wrapLocal(native);
}
