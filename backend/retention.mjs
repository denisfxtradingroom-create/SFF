// SFF: seven-day retention for media and wall posts.
// Plain-text chat messages, account data and profile artwork are not time-limited.
export const CONTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const expiryCutoff = (now = Date.now()) => now - CONTENT_TTL_MS;
export const isTimedMedia = (mime) => /^(image|audio|video)\//.test(String(mime || ""));

const mediaCondition = "(mime LIKE 'image/%' OR mime LIKE 'audio/%' OR mime LIKE 'video/%')";
const expiredMedia = `time <= ? AND ${mediaCondition}`;
const mediaOnly = `${expiredMedia} AND trim(coalesce(body,'')) = ''`;

// Run on startup and periodically on the backend. Both Turso and local SQLite
// support these statements. A transaction keeps related deletions consistent.
export async function pruneExpiredContent(db, now = Date.now()) {
  const cutoff = expiryCutoff(now);
  const hasMedia = await db.one(
    `SELECT id FROM messages WHERE ${expiredMedia} LIMIT 1`,
    cutoff,
  );
  const hasPosts = await db.one(
    "SELECT id FROM wall_posts WHERE created <= ? LIMIT 1",
    cutoff,
  );
  if (!hasMedia && !hasPosts) return { media: 0, posts: 0 };

  return db.transaction(async (tx) => {
    let media = 0;
    let posts = 0;
    if (hasMedia) {
      // Do not depend on foreign_keys being enabled in remote Turso connections.
      // Text-only replies to expired attachments stay in the conversation.
      await tx.run(
        `UPDATE messages SET parent = NULL WHERE parent IN (SELECT id FROM messages WHERE ${mediaOnly})`,
        cutoff,
      );
      await tx.run(
        `DELETE FROM thread_posts WHERE msg IN (SELECT id FROM messages WHERE ${mediaOnly}) OR root IN (SELECT id FROM messages WHERE ${mediaOnly})`,
        cutoff, cutoff,
      );
      await tx.run(
        `DELETE FROM reactions WHERE msg IN (SELECT id FROM messages WHERE ${mediaOnly})`,
        cutoff,
      );
      const removed = await tx.run(`DELETE FROM messages WHERE ${mediaOnly}`, cutoff);
      // A media message with a caption becomes an ordinary text message.
      const stripped = await tx.run(
        `UPDATE messages SET file = NULL, mime = NULL, bytes = NULL WHERE ${expiredMedia}`,
        cutoff,
      );
      media = removed.changes + stripped.changes;
    }
    if (hasPosts) {
      await tx.run(
        "DELETE FROM wall_likes WHERE post IN (SELECT id FROM wall_posts WHERE created <= ?)",
        cutoff,
      );
      await tx.run(
        "DELETE FROM wall_comments WHERE post IN (SELECT id FROM wall_posts WHERE created <= ?)",
        cutoff,
      );
      posts = (await tx.run("DELETE FROM wall_posts WHERE created <= ?", cutoff)).changes;
    }
    return { media, posts };
  });
}
