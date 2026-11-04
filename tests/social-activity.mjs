import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import WebSocket from "ws";

const dir=mkdtempSync(join(tmpdir(),"sff-social-event-"));
const server=spawn(process.execPath,[fileURLToPath(new URL("../backend/server.mjs",import.meta.url))],{
  env:{...process.env,SFF_DATA:dir,PORT:"0",HOST:"127.0.0.1",
    TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",SFF_REQUIRE_DURABLE_DB:"0",
    SFF_REQUIRE_VERIFIED_EMAIL:"0",SFF_ACCOUNT_RESET_ONCE:"",
    BREVO_API_KEY:"",RESEND_API_KEY:""},
  stdio:["ignore","pipe","inherit"],
});
const sockets=[];
try{
  const [start]=await once(server.stdout,"data");
  const base="http://127.0.0.1:"+start.toString().trim().split(" ").at(-1);
  async function req(user,action,body={}){
    const response=await fetch(base+"/api/"+action,{
      method:"POST",headers:{"Content-Type":"application/json",Cookie:user.cookie||""},
      body:JSON.stringify(body),
    });
    if(response.headers.has("set-cookie"))
      user.cookie=response.headers.get("set-cookie").split(";")[0];
    const result=await response.json();
    assert.equal(response.status,200,action+": "+JSON.stringify(result));return result;
  }
  const [owner,friend,stranger]=[{cookie:""},{cookie:""},{cookie:""}];
  for(const [user,username] of [[owner,"owner"],[friend,"friend"],[stranger,"stranger"]]){
    await req(user,"register",{
      username,firstName:username,lastName:"Test",
      email:username+"@example.test",emailConfirm:username+"@example.test",
      password:"safe-pass-123456",passwordConfirm:"safe-pass-123456"
    });
  }
  await req(owner,"friend",{username:"friend"});
  await req(friend,"accept",{username:"owner"});
  const connect=async(user)=>{
    const ws=new WebSocket(base.replace("http","ws")+"/live",{
      headers:{Cookie:user.cookie,Origin:base}});
    sockets.push(ws);await once(ws,"open");return ws;
  };
  const a=await connect(owner),b=await connect(friend),c=await connect(stranger);
  const undesired=[];
  c.on("message",(raw)=>{const event=JSON.parse(String(raw));if(event.type==="social_activity")undesired.push(event);});
  const next=(ws,kind)=>new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{ws.off("message",listener);reject(Error("Missing "+kind));},4000);
    function listener(raw){
      const v=JSON.parse(String(raw));
      if(v.type!=="social_activity"||v.kind!==kind)return;
      clearTimeout(timer);ws.off("message",listener);resolve(v);
    }
    ws.on("message",listener);
  });
  const newPost=next(b,"post");
  const post=(await req(owner,"wallCreate",{body:"Moj sadržaj"})).id;
  assert.equal((await newPost).post,post);
  const newLike=next(a,"like");
  assert.equal((await req(friend,"wallLike",{id:post})).liked,true);
  assert.equal((await newLike).post,post);
  const newComment=next(a,"comment");
  await req(friend,"wallComment",{id:post,body:"Odlična objava"});
  const event=await newComment;
  assert.equal(event.post,post);
  assert.equal(event.kind,"comment");
  assert(!("body" in event),"Comment text must not leak into notification");
  await req(friend,"wallLike",{id:post});
  const room=(await req(owner,"dm",{username:"friend"})).id;
  await req(owner,"post",{room,body:"Privatna poruka ne sme u zvonce"});
  await new Promise((resolve)=>setTimeout(resolve,90));
  assert.equal(undesired.length,0,"Strangers must never receive social events");
  const socialFile=await (await fetch(base+"/social-notifications.js")).text();
  assert(!socialFile.includes('if (message.type === "message" && message.notify === true)'),
    "Chat messages must not enter notification center");
  assert(socialFile.includes('socialKinds.has(r.kind)'),
    "Old chat previews must be removed from bell history");
  console.log("SFF social bell: friends-only post, likes, comments, no private previews PASS");
}finally{
  for(const socket of sockets)socket.terminate();
  server.kill();
}
