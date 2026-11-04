import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const dir=mkdtempSync(join(tmpdir(),"sff-dm-call-test-"));
const server=spawn(process.execPath,
  [fileURLToPath(new URL("../backend/server.mjs",import.meta.url))], {
    env:{...process.env,SFF_DATA:dir,HOST:"127.0.0.1",PORT:"0",
      TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",SFF_REQUIRE_DURABLE_DB:"0",
      SFF_ACCOUNT_RESET_ONCE:"",SFF_REQUIRE_VERIFIED_EMAIL:"0",
      BREVO_API_KEY:"",RESEND_API_KEY:""},
    stdio:["ignore","pipe","inherit"],
  });
const sockets=[];
try {
  const [line]=await once(server.stdout,"data");
  const base="http://127.0.0.1:"+line.toString().trim().split(" ").at(-1);
  async function req(user,action,body={}){
    const response=await fetch(base+"/api/"+action,{
      method:"POST",headers:{"Content-Type":"application/json",Cookie:user.cookie||""},
      body:JSON.stringify(body),
    });
    if(response.headers.has("set-cookie"))user.cookie=response.headers.get("set-cookie").split(";")[0];
    const bodyResult=await response.json();
    assert.equal(response.status,200,action+": "+JSON.stringify(bodyResult));
    return bodyResult;
  }
  const [alice,bob,outsider]=[{cookie:""},{cookie:""},{cookie:""}];
  for(const [user,username] of [[alice,"alice"],[bob,"bob"],[outsider,"outsider"]]){
    await req(user,"register",{
      username,firstName:username,lastName:"Test",
      email:username+"@example.test",emailConfirm:username+"@example.test",
      password:"not-real-pass-123",passwordConfirm:"not-real-pass-123"
    });
  }
  await req(alice,"friend",{username:"bob"});
  await req(bob,"accept",{username:"alice"});
  const room=(await req(alice,"dm",{username:"bob"})).id;
  async function connect(account){
    const ws=new WebSocket(base.replace("http","ws")+"/live",{
      headers:{Cookie:account.cookie,Origin:base}
    });
    sockets.push(ws);await once(ws,"open");return ws;
  }
  const a=await connect(alice),b=await connect(bob),c=await connect(outsider);
  const send=(ws,type,body={})=>ws.send(JSON.stringify({type,room,...body}));
  const next=(ws,type,timeoutMs=4000)=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{ws.off("message",onEvent);reject(Error(type+" never arrived"));},timeoutMs);
    function onEvent(raw){
      const v=JSON.parse(String(raw));
      if(v.type!==type)return;
      clearTimeout(timeout);ws.off("message",onEvent);resolve(v);
    }
    ws.on("message",onEvent);
  });
  const ringing=next(b,"call_incoming"),outgoing=next(a,"call_outgoing");
  send(a,"call_invite",{kind:"video"});
  assert.equal((await ringing).kind,"video");
  await outgoing;
  const denied=next(c,"error");
  send(c,"call_accept");
  assert.match((await denied).error,/privatnom razgovoru|pristup/i);
  const callerAccepted=next(a,"call_accepted");
  const calleeAccepted=next(b,"call_accepted");
  send(b,"call_accept");
  await Promise.all([callerAccepted,calleeAccepted]);
  const list1=next(a,"peers");
  send(a,"voice");
  assert.equal((await list1).peers.length,0);
  const list2=next(b,"peers");
  send(b,"voice");
  const peers=(await list2).peers;
  assert.equal(peers.length,1);
  const receivedSignal=next(a,"signal");
  send(b,"signal",{peer:peers[0].peer,data:{candidate:{candidate:"test"}}});
  assert.equal((await receivedSignal).type,"signal");
  const endingA=next(a,"call_ended"),endingB=next(b,"call_ended");
  send(a,"call_end");
  await Promise.all([endingA,endingB]);
  const ringingAgain=next(b,"call_incoming");
  send(a,"call_invite",{kind:"audio"});
  await ringingAgain;
  const ended=next(a,"call_ended");
  send(b,"call_decline");
  assert.equal((await ended).reason,"declined");
  b.close();await once(b,"close");
  const unavailable=next(a,"call_unavailable");
  send(a,"call_invite",{kind:"audio"});
  assert.match((await unavailable).reason,/nije povezan/i);
  console.log("SFF DM calls: secured invite, accept, WebRTC relay, decline, offline and third-user denial PASS");
} finally {
  for(const ws of sockets)ws.terminate();
  server.kill();
}
