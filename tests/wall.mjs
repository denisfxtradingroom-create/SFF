import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {once} from "node:events";
import {fileURLToPath} from "node:url";

const dir=mkdtempSync(join(tmpdir(),"sff-wall-test-"));
const entry=fileURLToPath(new URL("../backend/server.mjs",import.meta.url));
let server,origin;
async function boot(){
  server=spawn(process.execPath,[entry],{
    env:{...process.env,PORT:"0",HOST:"127.0.0.1",SFF_DATA:dir,SFF_DEBUG:"1"},
    stdio:["ignore","pipe","inherit"],
  });
  const [out]=await once(server.stdout,"data");
  origin="http://127.0.0.1:"+out.toString().trim().split(" ").at(-1);
}
const who=()=>({cookie:""});
const A=who(),B=who(),C=who();
async function request(u,action,body={},status=200){
  const r=await fetch(origin+"/api/"+action,{
    method:"POST",headers:{"Content-Type":"application/json",Cookie:u.cookie},
    body:JSON.stringify(body),
  });
  if(r.headers.has("set-cookie"))u.cookie=r.headers.get("set-cookie").split(";")[0];
  const v=await r.json();
  assert.equal(r.status,status,action+" "+JSON.stringify(v));
  return v;
}
async function reg(u,username){
  await request(u,"register",{
    username,email:username+"@example.test",emailConfirm:username+"@example.test",
    password:"password-1234",passwordConfirm:"password-1234",
    firstName:username,lastName:"SFF"
  });
}
try{
  await boot();
  const page=await fetch(origin+"/");
  assert.equal(page.status,200);
  const html=await page.text();
  assert.match(html,/\/social-wall\.js/);
  assert.match(html,/\/social-wall\.css/);
  assert.match(await (await fetch(origin+"/social-wall.js")).text(),/Početna/);
  assert.equal((await fetch(origin+"/social-wall.css")).status,200);
  await reg(A,"marko");await reg(B,"milica");await reg(C,"stranac");
  const a=(await request(A,"state")).me.id;
  const b=(await request(B,"state")).me.id;
  const c=(await request(C,"state")).me.id;
  await request(A,"friend",{username:"milica"});
  await request(B,"accept",{username:"marko"});

  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZuoAAAAASUVORK5CYII=","base64");
  const post=await request(A,"wallCreate",{body:"Prva objava za društvo!",image:png.toString("base64")});
  assert.equal((await request(B,"wallFeed")).posts.length,1);
  assert.equal((await request(C,"wallFeed")).posts.length,0);
  assert.equal((await request(A,"wallFeed")).posts.length,1);
  assert.equal((await request(B,"wallFeed",{user:a})).posts.length,1);
  await request(C,"wallFeed",{user:a},403);
  await request(C,"wallOne",{id:post.id},404);
  const privateImage=await fetch(origin+"/wall-media/"+post.id,{headers:{Cookie:C.cookie}});
  assert.notEqual(privateImage.status,200);
  const validImage=await fetch(origin+"/wall-media/"+post.id,{headers:{Cookie:B.cookie}});
  assert.equal(validImage.status,200);
  assert.equal(validImage.headers.get("Content-Type"),"image/png");
  assert.equal((await validImage.arrayBuffer()).byteLength,png.length);
  const anonymousImage=await fetch(origin+"/wall-media/"+post.id);
  assert.notEqual(anonymousImage.status,200);

  await request(B,"wallLike",{id:post.id});
  assert.equal((await request(A,"wallOne",{id:post.id})).likes,1);
  assert.equal((await request(B,"wallOne",{id:post.id})).liked,1);
  await request(B,"wallLike",{id:post.id});
  assert.equal((await request(A,"wallOne",{id:post.id})).likes,0);
  await request(C,"wallLike",{id:post.id},404);
  const comment=await request(B,"wallComment",{id:post.id,body:"Sjajno, sviđa mi se!"});
  assert.equal((await request(B,"wallComments",{id:post.id})).comments[0].body,"Sjajno, sviđa mi se!");
  await request(C,"wallComments",{id:post.id},404);
  await request(C,"wallCommentDelete",{id:comment.id},404);
  await request(A,"wallCommentDelete",{id:comment.id});
  assert.equal((await request(B,"wallComments",{id:post.id})).comments.length,0);

  await request(A,"wallShare",{id:post.id,target:c},403);
  const shared=await request(A,"wallShare",{id:post.id,target:b});
  assert(shared.room>0);
  const message=(await request(B,"history",{room:shared.room}))[0];
  assert.match(message.body,/#objava=/);
  await request(C,"wallDelete",{id:post.id},403);
  await request(B,"remove",{username:"marko"});
  assert.equal((await request(B,"wallFeed")).posts.length,0);
  await request(B,"wallOne",{id:post.id},404);
  assert.notEqual((await fetch(origin+"/wall-media/"+post.id,{headers:{Cookie:B.cookie}})).status,200);
  await request(A,"wallDelete",{id:post.id});
  assert.equal((await request(A,"wallFeed")).posts.length,0);
  await request(A,"wallCreate",{body:"<script>alert('x')</script>"});
  assert.equal((await request(A,"wallFeed")).posts[0].body,"<script>alert('x')</script>");
  await request(A,"wallCreate",{body:""},400);

  console.log("SFF Početna: friends-only visibility, image access, likes, comments, deletion, sharing PASS");
}finally{server?.kill()}
