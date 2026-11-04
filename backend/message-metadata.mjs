// A full page of messages needs two aggregate queries, not two for EACH message.
export async function addMessageMetadata(rows, all, deletedThrough = 0) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const params = ids.map(() => "?").join(",");
  const threadSql = "select root,count(*) n from thread_posts where root in (" + params + ")" +
    (deletedThrough ? " and msg>?" : "") + " group by root";
  const threads = await all(threadSql, ...ids, ...(deletedThrough ? [deletedThrough] : []));
  const reactions = await all(
    "select msg,emoji,count(*) n from reactions where msg in (" + params + ") group by msg,emoji",
    ...ids
  );
  const threadById = new Map(threads.map((x) => [x.root, x.n]));
  const reactionsById = new Map();
  for (const row of reactions) {
    if (!reactionsById.has(row.msg)) reactionsById.set(row.msg, []);
    reactionsById.get(row.msg).push({ emoji: row.emoji, n: row.n });
  }
  return rows.map((row) => ({
    ...row,
    threadCount: threadById.get(row.id) || 0,
    reactions: reactionsById.get(row.id) || [],
  }));
}
