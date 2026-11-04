// SFF storage retention. Only disposable uploads and social posts expire.
// Text conversations, accounts, profile pictures, settings and sessions stay intact.
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const retentionCutoff = (now = Date.now()) => now - RETENTION_MS;

export async function initRetention(db) {
  await db.exec(
    "CREATE INDEX IF NOT EXISTS sff_media_expiry ON messages(time, id) WHERE file IS NOT NULL;" +
    "CREATE INDEX IF NOT EXISTS sff_wall_expiry ON wall_posts(created, id);" +
    "CREATE INDEX IF NOT EXISTS sff_sessions_expiry ON sessions(expires);" +
    "CREATE INDEX IF NOT EXISTS sff_participants_uid_room ON participants(uid,room);" +
    "CREATE INDEX IF NOT EXISTS sff_members_uid_space ON members(uid,space);" +
    "CREATE INDEX IF NOT EXISTS sff_reactions_msg ON reactions(msg,emoji);" +
    "CREATE INDEX IF NOT EXISTS sff_messages_room_unread ON messages(room,id,uid);"
  );
}

export async function purgeExpiredContent(db, {
  now = Date.now(),
  batchSize = 64,
  maxBatches = 16,
} = {}) {
  if (!Number.isSafeInteger(now) || !Number.isInteger(batchSize) ||
      batchSize < 1 || batchSize > 200 || !Number.isInteger(maxBatches) ||
      maxBatches < 1 || maxBatches > 100) {
    throw Error("Neispravan parametar SFF čišćenja.");
  }
  const cutoff = retentionCutoff(now);
  let media = 0, posts = 0;

  // Small bounded batches prevent large remote Turso transactions and long locks.
  for (let batch = 0; batch < maxBatches; batch++) {
    const expired = await db.all(
      "select id from messages indexed by sff_media_expiry " +
      "where file is not null and time<=? order by time,id limit ?",
      cutoff, batchSize
    );
    if (!expired.length) break;
    const ids = expired.map((row) => row.id);
    const slots = ids.map(() => "?").join(",");
    const result = await db.run(
      "update messages set file=null,mime=null,bytes=null," +
      "body=case when trim(coalesce(body,''))='' then 'Prilog je uklonjen nakon 7 dana.' else body end " +
      "where id in (" + slots + ") and file is not null and time<=?",
      ...ids, cutoff
    );
    media += result.changes;
    if (expired.length < batchSize) break;
  }

  // Remove wall posts AND their comments/likes, even when FK pragma is disabled.
  for (let batch = 0; batch < maxBatches; batch++) {
    const expired = await db.all(
      "select id from wall_posts indexed by sff_wall_expiry " +
      "where created<=? order by created,id limit ?",
      cutoff, batchSize
    );
    if (!expired.length) break;
    const ids = expired.map((row) => row.id);
    const slots = ids.map(() => "?").join(",");
    const removed = await db.transaction(async (tx) => {
      await tx.run("delete from wall_comments where post in (" + slots + ")", ...ids);
      await tx.run("delete from wall_likes where post in (" + slots + ")", ...ids);
      return await tx.run(
        "delete from wall_posts where id in (" + slots + ") and created<=?",
        ...ids, cutoff
      );
    });
    posts += removed.changes;
    if (expired.length < batchSize) break;
  }
  return { media, posts };
}
