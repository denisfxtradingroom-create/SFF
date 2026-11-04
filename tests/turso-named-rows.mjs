import assert from "node:assert/strict";
import { wrapRemote } from "../backend/db.mjs";

function tursoRow(values, columns) {
  const row = [...values];
  for (let i = 0; i < columns.length; i++) {
    Object.defineProperty(row, columns[i], { value: values[i], enumerable: false });
  }
  return row;
}
const responses = [
  {
    columns: ["id", "username", "email", "password"],
    rows: [tursoRow([1, "tester", "test@example.test", "hashed-password"], ["id", "username", "email", "password"])],
  },
  {
    columns: ["total"],
    rows: [tursoRow([2], ["total"])],
  },
  {
    columns: ["name"],
    rows: [
      tursoRow(["users"], ["name"]),
      tursoRow(["sessions"], ["name"]),
    ],
  },
];
const client = {
  async execute(statement) {
    assert(statement.sql && Array.isArray(statement.args));
    const next = responses.shift();
    assert(next, "Unexpected query");
    return next;
  },
};
const db = wrapRemote(client);
const user = await db.one("select id,username,email,password from users where id=?", 1);
assert.deepEqual(user, { id:1, username:"tester", email:"test@example.test", password:"hashed-password" });
assert.equal("0" in user, false, "No numeric keys in normalized rows");
assert.deepEqual(await db.one("select count(*) as total from users"), { total:2 });
assert.deepEqual(await db.all("select name from sqlite_master"), [{ name:"users" }, { name:"sessions" }]);
console.log("PASS: Turso non-enumerable column names mapped to named SQL fields");
