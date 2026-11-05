import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../backend/db.mjs";
import { createPushDevices, pushConfigured } from "../backend/call-push.mjs";
import { createDmCallManager } from "../backend/dm-calls.mjs";

const dir = mkdtempSync(join(tmpdir(),"sff-fcm-"));
process.env.SFF_DATA=dir;
process.env.TURSO_DATABASE_URL="";
process.env.TURSO_AUTH_TOKEN="";
process.env.SFF_REQUIRE_DURABLE_DB="0";
process.env.SFF_FCM_SERVICE_ACCOUNT_JSON="";
assert.equal(pushConfigured(),false);
const db=await openDatabase();
await db.exec(readFileSync(new URL("../backend/schema.sql",import.meta.url),"utf8"));
const push=await createPushDevices(db);
for(const [id,name] of [[1,"alice"],[2,"bob"]])
  await db.run("insert into users(id,username,email,password,name) values(?,?,?,?,?)",
    id,name,name+"@example.test","dummy",name);
const token="fcm:"+("safe_token_1234567890".repeat(6));
await assert.rejects(push.register(2,"session2","wrong token /"),/Neispravan/);
await push.register(2,"session2",token);
assert.deepEqual(await push.list(2),[token]);
assert.deepEqual(await push.list(1),[]);
const unconfiguredStatus=await push.status(2);
assert.equal(unconfiguredStatus.configured,false);
assert.equal(unconfiguredStatus.registeredDevices,1);
assert.equal((await push.sendSelfTest(2)).acceptedByFirebase,false);
assert.equal(await push.sendCall(2,{room:4,kind:"video",name:"alice"}),false,
  "Without a Firebase project, do not transmit any notification");
process.env.SFF_FCM_SERVICE_ACCOUNT_JSON=JSON.stringify({
  project_id:"fake-test",client_email:"test@example.test",private_key:"TEST"
});
let captured;
const sent=await push.sendCall(2,{room:4,kind:"video",name:"alice"},async message=>{
  captured=message;
  return "message-id";
});
assert.equal(sent,true);
assert.equal(captured.notification,undefined);
assert.equal(captured.android.priority,"high");
assert.equal(captured.android.ttl,45000);
assert.equal(captured.data.room,"4");
assert(!JSON.stringify(captured).includes("lozinka"));
assert.equal(captured.data.name,"alice");
const selfTest=await push.sendSelfTest(2,async message=>{
  captured=message;
  return "test-notification";
});
assert.equal(selfTest.registeredDevices,1);
assert.equal(selfTest.acceptedByFirebase,true);
assert.equal(captured.data.type,"push_self_test");
assert.equal(captured.android.priority,"high");
assert.equal(captured.notification,undefined);
assert.equal(captured.android.restrictedPackageName,"app.sff.signal");
const messagePushed = await push.sendMessage(2, {
  room: 5,messageId: 177,sender: "Alice",body: "Ćao, jesi kući?"
}, async message => { captured=message; return "dm-notification"; });
assert.equal(messagePushed,true,"Registered Android recipient receives a DM push");
assert.equal(captured.data.type,"dm_message");
assert.equal(captured.data.message_id,"177");
assert.equal(captured.data.sender,"Alice");
assert.equal(captured.data.body,"Ćao, jesi kući?");
assert.equal(captured.android.restrictedPackageName,"app.sff.signal");
assert.equal(captured.notification,undefined,"Native service renders the SFF icon");
assert.equal(captured.android.priority,"high");
const delivery=await push.status(2);
assert.equal(delivery.latestMessagePush.state,"firebase_accepted");
assert.equal(delivery.latestMessagePush.registeredDevices,1);
assert.equal(delivery.latestMessagePush.firebaseAccepted,1);
assert.equal((await push.status(1)).latestMessagePush,null,
  "Private delivery telemetry must not leak to the sender");
assert.equal(await push.sendMessage(2, {room:5,messageId:0}),false,
  "Invalid DM payload must not reach Firebase");
const attachmentPushed = await push.sendMessage(2,{
  room:5,messageId:178,sender:"Alice",hasFile:true
},async message => { captured=message; return "dm-attachment"; });
assert.equal(attachmentPushed,true);
assert.equal(captured.data.body,"Poslat je prilog.");
await push.register(1,"new-session",token);
assert.deepEqual(await push.list(2),[],"Token must not remain assigned to prior account");
assert.equal(await push.sendMessage(2,{room:5,messageId:179}),false);
assert.equal((await push.status(2)).latestMessagePush.state,"no_registered_devices");
assert.deepEqual(await push.list(1),[token]);
await push.forgetSession("new-session");
assert.deepEqual(await push.list(1),[],"Logout must revoke device token");

const events={a:[],b:[]};
const caller={uid:1,peer:"peer-a",readyState:1,send:(v)=>events.a.push(JSON.parse(v))};
const recipient={uid:2,peer:"peer-b",readyState:1,send:(v)=>events.b.push(JSON.parse(v))};
const sockets=new Set([caller]);
let mobilePushCount=0;
const manager=createDmCallManager({
  sockets,roomFor:async(room,uid)=> room===5&&[1,2].includes(uid)?{kind:"dm",id:5,space:null}:null,
  all:async()=>[{uid:1},{uid:2}],
  one:async()=>({name:"Alice"}),
  demand:(ok,message="Denied")=>{if(!ok)throw Error(message)},
  limit:()=>{},
  callPush:{sendCall:async()=>{mobilePushCount++;return true;}},
});
await manager.handle(caller,{type:"call_invite",room:5,kind:"audio"});
assert.equal(mobilePushCount,1,"FCM rings for a fully offline receiver");
assert(events.a.some(x=>x.type==="call_outgoing"));
sockets.add(recipient);
manager.connected(recipient);
assert.equal(events.b.at(-1).type,"call_incoming",
  "Recipient reconnecting from notification must receive pending call invitation");
await manager.handle(recipient,{type:"call_accept",room:5});
assert(events.a.some(x=>x.type==="call_accepted"));
await manager.handle(caller,{type:"call_end",room:5});
assert.equal(events.b.at(-1).type,"call_ended");
await manager.handle(caller,{type:"call_invite",room:5,kind:"video"});
assert.equal(mobilePushCount,2,"Background Android must receive native ringtone even if its WebSocket remains connected");
await manager.handle(caller,{type:"call_end",room:5});
process.env.SFF_FCM_SERVICE_ACCOUNT_JSON="";
console.log("PASS: optional FCM, token privacy/reassignment/revoke, high-priority calls, offline wake and online fallback");
