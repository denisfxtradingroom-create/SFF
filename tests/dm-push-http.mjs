import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// End-to-end SFF API test: unlike a synthetic pushSelfTest, this posts an
// actual private message between two accounts and verifies that Firebase DM
// dispatch ran for the RECIPIENT. No Firebase network calls or real tokens.
const dir=mkdtempSync(join(tmpdir(),"sff-real-dm-fcm-"));
const proc=spawn(process.execPath,
  [fileURLToPath(new URL("../backend/server.mjs",import.meta.url))],{
    env:{
      ...process.env,HOST:"127.0.0.1",PORT:"0",SFF_DATA:dir,
      TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",
      SFF_REQUIRE_DURABLE_DB:"0",SFF_ACCOUNT_RESET_ONCE:"",
      SFF_REQUIRE_VERIFIED_EMAIL:"0",BREVO_API_KEY:"",RESEND_API_KEY:"",
      // Present => configured, but invalid => FCM client fails before network.
      SFF_FCM_SERVICE_ACCOUNT_JSON:"{invalid-ci-only-config"
    },
    stdio:["ignore","pipe","pipe"]
  });
let diagnostic="";
let processOutput="";
proc.stderr.on("data",d=>{ diagnostic+=String(d); });
try {
  const base=await new Promise((resolve,reject)=>{
    let stdout="";
    const timer=setTimeout(()=>reject(Error("SFF test server did not start")),12000);
    proc.stdout.on("data",chunk=>{
      stdout+=String(chunk);
      processOutput+=String(chunk);
      const match=stdout.match(/SFF ready (\d+)/);
      if(match){
        clearTimeout(timer);
        resolve("http://127.0.0.1:"+match[1]);
      }
    });
    proc.on("exit",code=>{
      clearTimeout(timer);
      reject(Error("SFF test server exited: "+code));
    });
  });
  async function req(account,action,body={}){
    const response=await fetch(base+"/api/"+action,{
      method:"POST",
      headers:{"Content-Type":"application/json",Cookie:account.cookie||""},
      body:JSON.stringify(body)
    });
    const setCookie=response.headers.get("set-cookie");
    if(setCookie)account.cookie=setCookie.split(";")[0];
    const result=await response.json();
    assert.equal(response.status,200,action+": "+JSON.stringify(result));
    return result;
  }
  const alice={cookie:""},bob={cookie:""};
  for(const [user,username] of [[alice,"alice"],[bob,"bob"]])
    await req(user,"register",{
      username,firstName:username,lastName:"Example",
      email:username+"@example.test",emailConfirm:username+"@example.test",
      password:"safe-test-pass-0123",passwordConfirm:"safe-test-pass-0123"
    });
  await req(alice,"friend",{username:"bob"});
  await req(bob,"accept",{username:"alice"});
  const room=(await req(alice,"dm",{username:"bob"})).id;
  await req(bob,"pushRegister",{token:"fcm:"+("test_token_1234567890".repeat(7))});
  const enrollment=await req(bob,"pushStatus");
  assert.equal(enrollment.configured,true,
    "Fake FCM env must enable the actual /api/post push branch");
  assert.equal(enrollment.registeredDevices,1);
  assert.equal(enrollment.latestMessagePush,null);

  const msg=await req(alice,"post",{room,body:"Poruka poslata kroz pravi DM API"});
  assert(Number.isSafeInteger(msg.id)&&msg.id>0);
  let delivery=null;
  for(let i=0;i<12;i++){
    delivery=(await req(bob,"pushStatus")).latestMessagePush;
    if(delivery)break;
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  if(!delivery)console.error("Real DM push diagnostics",{
    configured:enrollment.configured,
    registeredDevices:enrollment.registeredDevices,
    serverOutput:processOutput.slice(-2500),
    serverErrors:diagnostic.slice(-2500)
  });
  assert(delivery,"Real private message must invoke Firebase DM dispatch");
  assert(["attempting","firebase_unavailable"].includes(delivery.state),
    "Actual DM must attempt FCM; invalid test credentials cannot be accepted");
  assert.equal(delivery.registeredDevices,1);
  assert.equal(delivery.firebaseAccepted,0);
  assert.equal((await req(alice,"pushStatus")).latestMessagePush,null,
    "Real DM delivery status must be visible only to the receiver");
  const history=await req(bob,"history",{room});
  assert(history.some(m=>m.id===msg.id && m.body==="Poruka poslata kroz pravi DM API"),
    "Delivering a notification must never affect the saved message");
  console.log("SFF REAL DM push dispatch through /api/post, scoped Firebase status, saved chat PASS");
} finally {
  proc.kill();
}
