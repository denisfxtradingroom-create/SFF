// Explicit, one-time SFF account reset. Never exposed as a public API route.
// A durable receipt prevents a second reset after fresh registrations.
const RESET_SWITCH = "SFF-20261104-FRESH-START";

// Dependents first, then owning tables. No schema, credentials or app configuration is dropped.
const deletionOrder = [
  "thread_posts", "reactions", "reads", "bans", "audit",
  "overrides", "assignments", "roles",
  "room_meta", "timeouts", "chat_deletions", "alerts",
  "challenges", "preferences", "artwork",
  "wall_likes", "wall_comments", "wall_posts",
  "messages", "participants", "rooms", "members", "spaces",
  "friends", "blocks", "sff_push_devices", "sessions", "users",
];

export async function resetAppDataOnce(db, resetId) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(resetId)) {
    throw Error("Neispravan ID jednokratnog SFF reseta.");
  }

  await db.exec(`CREATE TABLE IF NOT EXISTS sff_account_reset_receipts(
    reset_id TEXT PRIMARY KEY,
    completed_at INTEGER NOT NULL,
    removed_users INTEGER NOT NULL
  );`);

  return db.transaction(async (tx) => {
    if (await tx.one("select reset_id from sff_account_reset_receipts where reset_id=?", resetId)) {
      return { alreadyApplied: true, removedUsers: 0 };
    }
    // Unknown tables may contain data that belongs to registered accounts.
    // Abort atomically instead of silently leaving identifiers behind.
    const found = await tx.all(
      "select name from sqlite_master where type='table' and name not like 'sqlite_%'"
    );
    const permitted = new Set([...deletionOrder, "sff_account_reset_receipts"]);
    const unknown = found.map((x) => x.name).filter((name) => !permitted.has(name));
    if (unknown.length) {
      throw Error("SFF reset prekinut: nepoznate tabele: " + unknown.join(", "));
    }
    const currentTables = new Set(found.map((x) => x.name));
    const before = await tx.one("select count(*) as total from users");
    for (const table of deletionOrder) {
      if (currentTables.has(table)) {
        await tx.run('delete from "' + table + '"');
      }
    }
    const remaining = await tx.one("select count(*) as total from users");
    if (Number(remaining.total) !== 0) {
      throw Error("SFF reset prekinut: nakon brisanja i dalje postoje nalozi.");
    }
    await tx.run(
      "insert into sff_account_reset_receipts(reset_id,completed_at,removed_users) values(?,?,?)",
      resetId, Date.now(), Number(before.total)
    );
    return { alreadyApplied: false, removedUsers: Number(before.total) };
  });
}

export async function resetSffWhenRequested(db) {
  if (process.env.SFF_ACCOUNT_RESET_ONCE !== RESET_SWITCH) return;
  if (!db.remote) {
    throw Error("Jednokratni produkcioni reset sme da radi samo nad Turso bazom.");
  }
  const result = await resetAppDataOnce(db, RESET_SWITCH);
  console.warn(
    "[SFF account reset] " +
      (result.alreadyApplied ? "already_completed" : "completed") +
      " removed_accounts=" + result.removedUsers
  );
}
