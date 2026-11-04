import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RETENTION_MS } from "../backend/retention.mjs";

const directory = mkdtempSync(join(tmpdir(),"sff-retention-http-"));
const server = spawn(process.execPath,[
  fileURLToPath(new URL("../backend/server.mjs",import.meta.url))
],{
  env:{...process.env,SFF_DATA:directory,PORT:"0",HOST:"127.0.0.1",
    TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",SFF_ACCOUNT_RESET_ONCE:"",
    SFF_REQUIRE_DURABLE_DB:"0",SFF_REQUIRE_VERIFIED_EMAIL:"0",
    RESEND_API_KEY:"",BREVO_API_KEY:""},
  stdio:["ignore","pipe","inherit"],
});
try {
  const [line] = await once(server.stdout,"data");
  const base = "http://127.0.0.1:"+line.toString().trim().split(" ").at(-1);
  let cookie="";
  async function request(action,payload={},expected=200) {
    const response=await fetch(base+"/api/"+action,{
      method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie},
      body:JSON.stringify(payload),
    });
    if(response.headers.has("set-cookie"))cookie=response.headers.get("set-cookie").split(";")[0];
    const value=await response.json();
    assert.equal(response.status,expected,action+": "+JSON.stringify(value));
    return value;
  }
  const user=await request("register",{
    username:"retention_test",firstName:"Test",lastName:"Korisnik",
    email:"retention@example.test",emailConfirm:"retention@example.test",
    password:"safe-test-password",passwordConfirm:"safe-test-password"
  });
  const room=await request("createSpace",{name:"Studio"});
  const current=(await request("state")).rooms.find(x=>x.space===room.id);
  assert(current,"Space must have a default text channel");
  const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuoAAAAASUVORK5CYII=";
  const message=await request("post",{room:current.id,body:"Tekst ostaje",file:"sample.png",data:png});
  const wallPost=await request("wallCreate",{body:"Privremena objava",image:png});
  const old=Date.now()-RETENTION_MS-3600000;
  const sql=new DatabaseSync(join(directory,"sff.sqlite"));
  sql.prepare("update messages set time=? where id=?").run(old,message.id);
  sql.prepare("update wall_posts set created=? where id=?").run(old,wallPost.id);
  sql.close();
  const history=await request("history",{room:current.id});
  const target=history.find(x=>x.id===message.id);
  assert(target,"Expired attachment must keep its text message");
  assert.equal(target.body,"Tekst ostaje");
  assert.equal(target.file,null);
  assert.equal(target.mime,null);
  const media=await fetch(base+"/media/"+message.id,{headers:{Cookie:cookie}});
  assert.notEqual(media.status,200,"Old attachment must not be downloadable");
  assert.equal((await request("wallFeed")).posts.length,0,
    "Expired wall post must not appear while storage sweep has not run");
  const wallImage=await fetch(base+"/wall-media/"+wallPost.id,{headers:{Cookie:cookie}});
  assert.notEqual(wallImage.status,200,"Expired wall photo must not be downloadable");
  const wallOne=await fetch(base+"/api/wallOne",{method:"POST",
    headers:{"Content-Type":"application/json",Cookie:cookie},
    body:JSON.stringify({id:wallPost.id})});
  assert.equal(wallOne.status,404,"Expired post must not open directly");
  assert.equal((await request("state")).me.username,"retention_test");
  console.log("SFF retention HTTP: media and wall posts hidden at 7-day boundary; text and account intact PASS");
} finally {
  server.kill();
}
