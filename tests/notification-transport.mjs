import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const dir=mkdtempSync(join(tmpdir(),"sff-notify-"));
const server=spawn(process.execPath,[fileURLToPath(new URL("../backend/server.mjs",import.meta.url))],{
  env:{...process.env,SFF_DATA:dir,HOST:"127.0.0.1",PORT:"0",
    TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",SFF_ACCOUNT_RESET_ONCE:"",
    SFF_REQUIRE_DURABLE_DB:"0",SFF_REQUIRE_VERIFIED_EMAIL:"0",
    RESEND_API_KEY:"",BREVO_API_KEY:""},
  stdio:["ignore","pipe","inherit"],
});
const sockets=[];
try{
  const [line]=await once(server.stdout,"data");
  const base="http://127.0.0.1:"+line.toString().trim().split(" ").at(-1);
  async function call(user,action,body={}){
    const response=await fetch(base+"/api/"+action,{
      method:"POST",headers:{"Content-Type":"application/json",Cookie:user.cookie||""},
      body:JSON.stringify(body),
    });
    if(response.headers.has("set-cookie"))user.cookie=response.headers.get("set-cookie").split(";")[0];
    const result=await response.json();
    assert.equal(response.status,200,action+": "+JSON.stringify(result));
    return result;
  }
  const alice={cookie:""},bob={cookie:""};
  for(const [user,username] of [[alice,"alice"],[bob,"bob"]]){
    await call(user,"register",{
      username,email:username+"@example.test",emailConfirm:username+"@example.test",
      firstName:username,lastName:"Test",password:"test-strong-password",passwordConfirm:"test-strong-password"
    });
  }
  await call(alice,"friend",{username:"bob"});
  await call(bob,"accept",{username:"alice"});
  const room=(await call(alice,"dm",{username:"bob"})).id;
  await call(bob,"alerts",{scope:"r"+room,policy:"mentions"});
  for(let i=0;i<2;i++){
    const ws=new WebSocket(base.replace("http","ws")+"/live",{headers:{Cookie:bob.cookie,Origin:base}});
    sockets.push(ws);
    await once(ws,"open");
  }
  const next=async(ws)=>{
    return await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{ws.off("message",listener);reject(Error("Missing notification"))},4000);
      const listener=(raw)=>{
        const e=JSON.parse(String(raw));
        if(e.type!=="message")return;
        clearTimeout(timeout);ws.off("message",listener);resolve(e);
      };
      ws.on("message",listener);
    });
  };
  async function sendAndCheck(body,expected){
    const seen=sockets.map(next);
    await call(alice,"post",{room,body});
    const events=await Promise.all(seen);
    for(const event of events){
      assert.equal(event.notify,expected,body+": expected policy result");
      assert.equal(event.room,room);
      assert.equal(event.name,"alice Test");
    }
  }
  await sendAndCheck("Obicna poruka",false);
  await sendAndCheck("Cao @bob",true);
  await call(bob,"profile",{name:"bob Test",about:"",custom:"",status:"Do Not Disturb"});
  await sendAndCheck("Cao @bob jos jednom",false);
  await call(bob,"profile",{name:"bob Test",about:"",custom:"",status:"Online"});
  await call(bob,"alerts",{scope:"r"+room,policy:"off"});
  await sendAndCheck("Obicna poruka",false);
  await call(bob,"alerts",{scope:"r"+room,policy:"all"});
  await sendAndCheck("Obicna poruka",true);
  console.log("SFF notification policies: two devices, mentions, DND, off, all PASS");
} finally {
  for(const socket of sockets)socket.terminate();
  server.kill();
}
