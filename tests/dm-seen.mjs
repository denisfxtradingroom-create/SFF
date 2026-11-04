import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import WebSocket from "ws";

const dir=mkdtempSync(join(tmpdir(),"sff-seen-"));
const server=spawn(process.execPath,
  [fileURLToPath(new URL("../backend/server.mjs",import.meta.url))],{
    env:{...process.env,HOST:"127.0.0.1",PORT:"0",SFF_DATA:dir,
      TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",SFF_REQUIRE_DURABLE_DB:"0",
      SFF_ACCOUNT_RESET_ONCE:"",SFF_REQUIRE_VERIFIED_EMAIL:"0",
      BREVO_API_KEY:"",RESEND_API_KEY:""},
    stdio:["ignore","pipe","inherit"]
  });
let socket;
try {
  const [line]=await once(server.stdout,"data");
  const base="http://127.0.0.1:"+line.toString().trim().split(" ").at(-1);
  async function req(user,action,body={}){
    const response=await fetch(base+"/api/"+action,{
      method:"POST",headers:{"Content-Type":"application/json",Cookie:user.cookie||""},
      body:JSON.stringify(body)
    });
    if(response.headers.has("set-cookie"))
      user.cookie=response.headers.get("set-cookie").split(";")[0];
    const value=await response.json();
    assert.equal(response.status,200,action+": "+JSON.stringify(value));
    return value;
  }
  const alice={cookie:""},bob={cookie:""};
  for(const [user,username] of [[alice,"alice"],[bob,"bob"]]){
    await req(user,"register",{
      username,firstName:username,lastName:"Example",
      email:username+"@example.test",emailConfirm:username+"@example.test",
      password:"safe-test-pass-0123",passwordConfirm:"safe-test-pass-0123"
    });
  }
  await req(alice,"friend",{username:"bob"});
  await req(bob,"accept",{username:"alice"});
  const room=(await req(alice,"dm",{username:"bob"})).id;
  socket=new WebSocket(base.replace("http","ws")+"/live",{
    headers:{Cookie:alice.cookie,Origin:base}
  });
  await once(socket,"open");
  const message=(await req(alice,"post",{room,body:"Provera viđeno"})).id;
  assert(Number((await req(alice,"state")).dmSeen?.[room]||0)<message,
    "Message must NOT be marked Seen before the receiver opens it");
  const history=await req(bob,"history",{room});
  assert(history.some((m)=>m.id===message),"Receiver must be able to read message");
  assert(Number((await req(alice,"state")).dmSeen?.[room]||0)<message,
    "Loading messages alone is not enough; client sends read after visible display");
  const receipt=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("Missing read receipt")),4000);
    function onMessage(raw){
      const event=JSON.parse(String(raw));
      if(event.type!=="read_receipt")return;
      clearTimeout(timer);socket.off("message",onMessage);resolve(event);
    }
    socket.on("message",onMessage);
  });
  await req(bob,"read",{room,last:message});
  const event=await receipt;
  assert.equal(event.room,room);
  assert.equal(event.last,message);
  assert(Number((await req(alice,"state")).dmSeen?.[room]||0)>=message);
  const app=readFileSync(new URL("../client/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../client/messenger.css",import.meta.url),"utf8");
  assert(app.includes('previousShell.dataset.activeRoom'),"Chat DOM must be preserved across state updates");
  assert(app.includes('data-sff-msg-id'),"Messages need stable DOM keys");
  assert(app.includes('✓✓ Viđeno')&&app.includes('✓ Poslato'));
  assert(css.includes(".msg.sffOwn")&&css.includes(".msg.sffOther"));
  console.log("SFF DM seen: visible read receipt, no premature seen, steady chat DOM and left/right layout PASS");
}finally {socket?.terminate();server.kill();}
