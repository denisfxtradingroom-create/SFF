import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { spawnSync } from "node:child_process";

const path = new URL("../client/voice.js", import.meta.url);
const source = readFileSync(path, "utf8");
const syntax = spawnSync(process.execPath,["--check",path.pathname],{encoding:"utf8"});
assert.equal(syntax.status,0,syntax.stderr);
assert(source.includes('if (player.srcObject !== media) player.srcObject = media'),
  "Remote MediaStream must be retained between rerenders");
assert(source.includes('player.play()'),"Remote playback must be explicitly started");
assert(source.includes('Medijska veza nije uspela'),"ICE failures must be visible to users");
const audio={kind:"audio",enabled:true,stop(){}};
class Stream {
  constructor(t=[]){this.t=t;}
  getTracks(){return [...this.t];}
  getAudioTracks(){return this.t.filter(x=>x.kind==="audio");}
  addTrack(t){this.t.push(t);}
}
class Peer {
  constructor(){this.signalingState="stable";this.connectionState="new";this.iceConnectionState="new";this.remoteDescription=null;this.transceivers=[];this.candidates=[];}
  addTrack(track){return {track};}
  addTransceiver(kind){const sender={replaceTrack:async()=>{}};const t={receiver:{track:{kind}},sender,direction:"sendrecv"};this.transceivers.push(t);return t;}
  getTransceivers(){return this.transceivers;}
  async createOffer(opts={}){return {type:"offer",iceRestart:!!opts.iceRestart};}
  async createAnswer(){return {type:"answer"};}
  async setLocalDescription(d){this.localDescription=d;}
  async setRemoteDescription(d){await Promise.resolve();this.remoteDescription=d;if(d.type==="offer")this.addTransceiver("video");}
  async addIceCandidate(c){assert(this.remoteDescription,"Candidate arrived before remote SDP");this.candidates.push(c);}
  close(){this.signalingState="closed";}
}
const sent=[];
const fake={
  __send:(e)=>sent.push(e),MediaStream:Stream,RTCPeerConnection:Peer,
  AudioContext:class {resume(){return Promise.resolve()}close(){return Promise.resolve()}},
  navigator:{mediaDevices:{getUserMedia:async()=>new Stream([audio])}},
  document:{querySelector:()=>null},console,setInterval,clearInterval,
};
const code=source.replace('import { sendVoice } from "./app.js";','const sendVoice=globalThis.__send;')
  .replace(/^export /gm,"");
runInNewContext(code+"\nglobalThis.testApi={voiceAction,voiceEvent,voiceLeave,peers};",fake,{timeout:10000});
const client=fake.testApi;
try{
  await client.voiceAction("join",7);
  await client.voiceEvent({type:"peers",ice:[],peers:[{peer:"remote",uid:2}]});
  const connection=client.peers.get("remote").pc;
  connection.iceConnectionState="failed";
  connection.oniceconnectionstatechange();
  await new Promise(r=>setTimeout(r,0));
  assert(sent.some(e=>e.data?.description?.iceRestart),"ICE retry must be signaled");
  const offer=client.voiceEvent({type:"signal",peer:"other",uid:3,data:{description:{type:"offer"}}});
  const ice=client.voiceEvent({type:"signal",peer:"other",uid:3,data:{candidate:{candidate:"abc"}}});
  await Promise.all([offer,ice]);
  assert.equal(client.peers.get("other").pc.candidates.length,1);
  console.log("SFF WebRTC: valid syntax, stable media code, ICE recovery and ordered signaling PASS");
}finally{client.voiceLeave();}
