import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import WebSocket from "ws";
const server=spawn(process.execPath,[fileURLToPath(new URL("../backend/server.mjs",import.meta.url))],{
  env:{...process.env,HOST:"127.0.0.1",PORT:"0",SFF_DATA:mkdtempSync(join(tmpdir(),"sff-unread-"))},
  stdio:["ignore","pipe","inherit"]
});
let socket;
try{
  const [line]=await once(server.stdout,"data");
  const base="http://127.0.0.1:"+line.toString().trim().split(" ").at(-1);
  const a={cookie:""},b={cookie:""};
  async function req(user,action,body={}){
    const response=await fetch(base+"/api/"+action,{
      method:"POST",headers:{"Content-Type":"application/json",Cookie:user.cookie},
      body:JSON.stringify(body)
    });
    if(response.headers.has("set-cookie"))user.cookie=response.headers.get("set-cookie").split(";")[0];
    const result=await response.json();
    assert.equal(response.status,200,action+": "+JSON.stringify(result));
    return result;
  }
  for(const [user,name] of [[a,"first"],[b,"second"]])
    await req(user,"register",{username:name,firstName:name,lastName:"Test",
      email:name+"@example.test",emailConfirm:name+"@example.test",
      password:"password-12345",passwordConfirm:"password-12345"});
  await req(a,"friend",{username:"second"});
  await req(b,"accept",{username:"first"});
  const room=(await req(a,"dm",{username:"second"})).id;
  socket=new WebSocket(base.replace("http","ws")+"/live",{
    headers:{Cookie:b.cookie,Origin:base}
  });
  await once(socket,"open");
  const first=(await req(a,"post",{room,body:"test1"})).id;
  assert.equal((await req(b,"state")).rooms.find(x=>x.id===room).unread,1);
  const refreshed=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error("read notification missing")),3000);
    const listener=(raw)=>{
      if(JSON.parse(String(raw)).type!=="state")return;
      clearTimeout(timer);socket.off("message",listener);resolve();
    };
    socket.on("message",listener);
  });
  await req(b,"read",{room,last:first});
  await refreshed;
  assert.equal((await req(b,"state")).rooms.find(x=>x.id===room).unread,0);
  await req(b,"read",{room,last:Number.MAX_SAFE_INTEGER});
  const next=(await req(a,"post",{room,body:"test2"})).id;
  assert(next>first);
  assert.equal((await req(b,"state")).rooms.find(x=>x.id===room).unread,1);
  console.log("SFF read badge state and watermark checks passed.");
}finally{socket?.close();server.kill()}
