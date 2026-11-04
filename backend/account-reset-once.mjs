/*
 * One-off irreversible SFF clean slate.
 *
 * Deletes only app-owned data and preserves SQL schema, Turso connection,
 * administrative reset marker and the running web application.
 * Marker is committed in the SAME transaction as the deletions.
 */
export const RESET_ACCOUNT_TABLES = Object.freeze([
  "wall_comments", "wall_likes", "wall_posts",
  "thread_posts", "reactions", "chat_deletions", "reads",
  "messages",
  "overrides", "assignments", "roles",
  "audit", "bans", "timeouts", "room_meta",
  "participants", "members", "friends", "blocks",
  "alerts", "artwork", "challenges", "preferences", "sessions",
  "rooms", "spaces", "users",
]);

export async function resetAccountDataOnce(db, marker, { allowLocalTest = false } = {}) {
  if (!marker) return { active: false };
  if (!/^sff-reset-[a-z0-9-]{8,80}$/.test(marker)) {
    throw new Error("Pogrešna oznaka jednokratnog SFF reseta.");
  }
  if (!db.remote && !allowLocalTest) {
    throw new Error("SFF reset zahteva trajnu Turso bazu, a ne lokalni SQLite.");
  }

  // Never keep a reset flag only in process memory: a Render restart would
  // otherwise erase new accounts again. Store it in the durable Turso DB.
  await db.exec(
    "CREATE TABLE IF NOT EXISTS sff_admin_meta(" +
    "key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );

  const outcome = await db.transaction(async (tx) => {
    const applied = await tx.one(
      "SELECT value FROM sff_admin_meta WHERE key='last_account_reset'",
    );
    if (applied?.value === marker) return { alreadyApplied: true };

    const tables = new Set(
      (await tx.all("SELECT name FROM sqlite_master WHERE type='table'"))
        .map((row) => row.name),
    );
    if (!tables.has("users")) {
      throw new Error("SFF tabela users ne postoji; reset je otkazan.");
    }

    const before = {};
    for (const name of ["users", "sessions", "messages", "wall_posts", "friends"]) {
      if (tables.has(name)) {
        before[name] = Number(
          (await tx.one('SELECT COUNT(*) AS count FROM "' + name + '"'))?.count || 0,
        );
      }
    }
    for (const name of RESET_ACCOUNT_TABLES) {
      if (tables.has(name)) {
        await tx.run('DELETE FROM "' + name + '"');
      }
    }

    // Deliberately do NOT reset AUTOINCREMENT/ROWID sequences, because a
    // reused numeric account ID may collide with old browser notification
    // caches on existing Android/Windows installations.
    await tx.run(
      "INSERT INTO sff_admin_meta(key,value) VALUES('last_account_reset',?) " +
      "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      marker,
    );
    await tx.run(
      "INSERT INTO sff_admin_meta(key,value) VALUES('last_account_reset_at',?) " +
      "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      String(Date.now()),
    );

    for (const name of ["users", "sessions", "messages", "wall_posts", "friends"]) {
      if (!tables.has(name)) continue;
      const n = Number(
        (await tx.one('SELECT COUNT(*) AS count FROM "' + name + '"'))?.count || 0,
      );
      if (n !== 0) throw new Error("SFF reset nije ispraznio tabelu " + name);
    }

    return { alreadyApplied: false, before };
  });

  if (outcome.alreadyApplied) {
    console.log("[SFF clean slate] Ranije primenjeni reset preskočen. Novi nalozi su sačuvani.");
  } else {
    console.log(
      "[SFF clean slate] Jednokratno obrisani podaci, Turso transakcija potvrđena:",
      JSON.stringify(outcome.before),
    );
  }
  return { active: true, ...outcome };
}
