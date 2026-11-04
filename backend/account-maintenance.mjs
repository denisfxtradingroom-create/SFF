import { randomUUID } from "node:crypto";

// Privileged, one-time maintenance. Never expose this as an HTTP endpoint.
// The reset marker is stored in the same durable database as the user data.
// Keeping that marker makes restarts and redeploys idempotent.
const ACCOUNT_TABLES = Object.freeze([
  "wall_comments", "wall_likes", "wall_posts",
  "thread_posts", "reactions", "reads", "chat_deletions",
  "alerts", "artwork", "audit", "bans", "overrides",
  "assignments", "roles", "timeouts", "room_meta",
  "messages", "participants", "rooms", "members",
  "spaces", "friends", "blocks", "sessions",
  "preferences", "challenges", "users",
]);

export async function prepareAccountEpoch(db, marker = "", { allowLocalTest = false } = {}) {
  await db.exec(
    "CREATE TABLE IF NOT EXISTS sff_admin_meta(" +
      "key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  await db.run(
    "INSERT OR IGNORE INTO sff_admin_meta(key,value) VALUES('epoch',?)",
    randomUUID(),
  );

  if (marker) {
    if (!/^sff-reset-[a-z0-9-]{8,90}$/.test(marker)) {
      throw Error("Neispravna oznaka jednokratnog resetovanja SFF-a.");
    }
    if (!db.remote && !allowLocalTest) {
      throw Error("Reset SFF naloga dozvoljen je isključivo za povezanu trajnu bazu.");
    }
    const outcome = await db.transaction(async (tx) => {
      const previous = await tx.one(
        "SELECT value FROM sff_admin_meta WHERE key='last_account_reset'"
      );
      if (previous?.value === marker) return { alreadyApplied: true };

      // The list is fixed in source code: never execute table names from user input.
      const tables = new Set(
        (await tx.all("SELECT name FROM sqlite_master WHERE type='table'"))
          .map((row) => row.name)
      );
      if (!tables.has("users")) throw Error("SFF tabela naloga ne postoji.");
      const users = Number((await tx.one("SELECT count(*) AS n FROM users")).n);
      for (const table of ACCOUNT_TABLES) {
        if (tables.has(table)) await tx.run('DELETE FROM "' + table + '"');
      }
      await tx.run(
        "INSERT INTO sff_admin_meta(key,value) VALUES('epoch',?) " +
          "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        randomUUID()
      );
      await tx.run(
        "INSERT INTO sff_admin_meta(key,value) VALUES('last_account_reset',?) " +
          "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        marker
      );
      return { users };
    });
    console.log(
      outcome.alreadyApplied
        ? "SFF jednokratni reset je već primenjen. Novi nalozi ostaju sačuvani."
        : "SFF jednokratni reset je završen. Uklonjeni nalozi: " + outcome.users
    );
  }
  return (await db.one("SELECT value FROM sff_admin_meta WHERE key='epoch'")).value;
}
