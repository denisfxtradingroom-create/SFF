export async function rolePolicy({ db, one, all, run, member, demand, str }) {
  await db.exec(`CREATE TABLE IF NOT EXISTS roles(id INTEGER PRIMARY KEY,space INTEGER REFERENCES spaces ON DELETE CASCADE,name TEXT,color TEXT,rank INTEGER,canPost INTEGER,canVoice INTEGER,UNIQUE(space,name));
 CREATE TABLE IF NOT EXISTS assignments(space INTEGER,uid INTEGER,role INTEGER REFERENCES roles ON DELETE CASCADE,PRIMARY KEY(space,uid),FOREIGN KEY(space,uid) REFERENCES members(space,uid) ON DELETE CASCADE);
 CREATE TABLE IF NOT EXISTS overrides(room INTEGER REFERENCES rooms ON DELETE CASCADE,role INTEGER REFERENCES roles ON DELETE CASCADE,visible INTEGER,canPost INTEGER,canVoice INTEGER,PRIMARY KEY(room,role));`);

  const assigned = async (space, uid) =>
    one(
      "select r.* from roles r join assignments a on a.role=r.id where a.space=? and a.uid=?",
      space,
      uid,
    );

  async function access(r, m) {
    const role = await assigned(r.space, m.uid);
    const override =
      role && (await one("select * from overrides where room=? and role=?", r.id, role.id));
    const admin = m.role === "Administrator";
    return {
      visible:
        admin || Boolean(override ? override.visible : !r.restricted || m.role !== "Member"),
      canPost: admin || Boolean(override?.canPost ?? role?.canPost ?? 1),
      canVoice: admin || Boolean(override?.canVoice ?? role?.canVoice ?? 1),
      badge: role?.name || "",
      color: role?.color || "",
    };
  }

  const roles = async (space) => all("select * from roles where space=? order by rank desc,id", space);

  async function handle(a, b, u) {
    if (!["newRole", "assignRole", "override", "roles"].includes(a)) return;
    const m = await member(b.space, u);
    demand(m);
    if (a === "roles") return roles(b.space);
    demand((await one("select owner from spaces where id=?", b.space))?.owner === u);

    if (a === "newRole") {
      const name = str(b.name, 30);
      demand(
        !["everyone", "Administrator", "Moderator", "Member"]
          .map((x) => x.toLowerCase())
          .includes(name.toLowerCase()) &&
          /^[a-z0-9_]+$/i.test(name) &&
          /^#[0-9a-f]{6}$/i.test(b.color),
        "Proveri naziv i boju uloge.",
        400,
      );
      const rank = Number(b.rank);
      demand(Number.isInteger(rank) && rank >= 0 && rank <= 99, "Prioritet mora biti 0–99.", 400);
      await run(
        "insert into roles(space,name,color,rank,canPost,canVoice) values(?,?,?,?,?,?)",
        b.space,
        name,
        b.color,
        rank,
        b.canPost ? 1 : 0,
        b.canVoice ? 1 : 0,
      );
    } else {
      const role = await one("select * from roles where space=? and id=?", b.space, b.role);
      demand(role);
      if (a === "assignRole") {
        demand(await member(b.space, b.target));
        await run("insert or replace into assignments values(?,?,?)", b.space, b.target, role.id);
      } else {
        demand(await one("select 1 from rooms where space=? and id=?", b.space, b.room));
        await run(
          "insert or replace into overrides values(?,?,?,?,?)",
          b.room,
          role.id,
          b.visible ? 1 : 0,
          b.canPost ? 1 : 0,
          b.canVoice ? 1 : 0,
        );
      }
    }

    await run(
      "insert into audit(space,uid,action,time) values(?,?,?,?)",
      b.space,
      u,
      a + " " + String(b.name || b.role),
      Date.now(),
    );
    return {};
  }

  return { access, assigned, roles, handle };
}
