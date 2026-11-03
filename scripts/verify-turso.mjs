import { randomUUID } from "node:crypto";
import { openDatabase } from "../backend/db.mjs";

// Run only after TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are set privately.
// Two independent connections must read the same server-side row.
process.env.SFF_REQUIRE_DURABLE_DB = "1";
let writer, reader;
const key = randomUUID();
try {
  writer = await openDatabase();
  if (!writer.remote) throw Error("Nije povezana Turso baza.");
  await writer.exec(
    "CREATE TABLE IF NOT EXISTS sff_persistence_probe(id TEXT PRIMARY KEY, written INTEGER NOT NULL)"
  );
  const time = Date.now();
  await writer.run(
    "INSERT INTO sff_persistence_probe(id,written) VALUES(?,?)",
    key, time,
  );
  writer.client.close();
  writer = null;

  reader = await openDatabase();
  const result = await reader.one(
    "SELECT written FROM sff_persistence_probe WHERE id=?",
    key,
  );
  if (Number(result?.written) !== time)
    throw Error("Provera trajnosti baze nije prošla.");
  await reader.run("DELETE FROM sff_persistence_probe WHERE id=?", key);
  console.log("USPEH: Turso čuva podatke između nezavisnih povezivanja.");
} catch (error) {
  console.error("GREŠKA: Turso nije spreman za produkciju:", error.message);
  process.exitCode = 1;
} finally {
  if (writer?.client) writer.client.close();
  if (reader?.client) reader.client.close();
}
