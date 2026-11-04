// Ephemeral, authenticated two-person call signaling.
// No polling or Turso writes. Existing voice-channel WebRTC transports the media.
export function createDmCallManager({sockets,roomFor,all,one,demand,limit}) {
  const calls = new Map();
  const send = (socket,event) => {
    if(socket?.readyState===1)socket.send(JSON.stringify(event));
  };
  const targets = (uid) => [...sockets].filter((socket)=>
    socket.uid===uid && socket.readyState===1);
  function finish(call, reason="ended") {
    if(calls.get(call.room)!==call)return;
    clearTimeout(call.timer);
    calls.delete(call.room);
    const event={type:"call_ended",room:call.room,reason};
    for(const socket of [...targets(call.caller),...targets(call.callee)])
      send(socket,event);
  }
  async function handle(socket,b) {
    if(!["call_invite","call_accept","call_decline","call_end"].includes(b?.type))
      return false;
    const room=Number(b.room);
    const who=socket.uid;
    demand(Number.isSafeInteger(room) && room>0,"Neispravan poziv.",400);
    limit("call:"+who,45);
    const accessible=await roomFor(room,who);
    demand(accessible?.kind==="dm" && !accessible.space,
      "Poziv je dostupan samo u privatnom razgovoru.",403);
    let call=calls.get(room);
    if(b.type==="call_invite") {
      demand(!call,"U razgovoru već postoji poziv.",409);
      const users=await all("select uid from participants where room=?",room);
      demand(users.length===2 && users.some((x)=>x.uid===who),
        "Privatni razgovor nije dostupan.",403);
      const other=users.find((x)=>x.uid!==who)?.uid;
      demand(other,"Nije moguće pozvati samog sebe.",400);
      const busy=[...calls.values()].some((c)=>
        [c.caller,c.callee].includes(who)||[c.caller,c.callee].includes(other));
      demand(!busy,"Jedan od korisnika je već u pozivu.",409);
      if(!targets(other).length) {
        send(socket,{type:"call_unavailable",room,
          reason:"Primalac trenutno nije povezan. Pozivi u ugašenoj aplikaciji zahtevaju push servis."});
        return true;
      }
      const type=b.kind==="video"?"video":"audio";
      const sender=await one("select name from users where id=?",who);
      call={room,caller:who,callee:other,callerPeer:socket.peer,calleePeer:null,
        status:"ringing",kind:type};
      calls.set(room,call);
      call.timer=setTimeout(()=>finish(call,"missed"),45000);
      call.timer.unref?.();
      send(socket,{type:"call_outgoing",room,kind:type});
      for(const recipient of targets(other))
        send(recipient,{type:"call_incoming",room,kind:type,
          name:sender?.name||"Korisnik"});
      return true;
    }
    demand(call && [call.caller,call.callee].includes(who),
      "Poziv nije dostupan.",404);
    if(b.type==="call_accept") {
      demand(call.status==="ringing" && who===call.callee,
        "Poziv više ne čeka odgovor.",409);
      call.status="active";
      call.calleePeer=socket.peer;
      clearTimeout(call.timer);
      for(const endpoint of [call.callerPeer,call.calleePeer]) {
        const peer=[...sockets].find((s)=>s.peer===endpoint);
        send(peer,{type:"call_accepted",room,kind:call.kind});
      }
      // Other devices must not join the same two-person call.
      for(const endpoint of [...targets(call.caller),...targets(call.callee)]) {
        if(endpoint.peer!==call.callerPeer && endpoint.peer!==call.calleePeer)
          send(endpoint,{type:"call_ended",room,reason:"answered_on_other_device"});
      }
      return true;
    }
    if(b.type==="call_decline") {
      demand(call.status==="ringing","Poziv više ne čeka odgovor.",409);
      finish(call,"declined");
      return true;
    }
    if(b.type==="call_end") {
      finish(call,"ended");
      return true;
    }
    return true;
  }
  const authorized=(socket,room)=>{
    const c=calls.get(room);
    return !!(c && c.status==="active" &&
      [c.callerPeer,c.calleePeer].includes(socket.peer) &&
      [c.caller,c.callee].includes(socket.uid));
  };
  const disconnected=(socket)=>{
    for(const call of [...calls.values()])
      if(call.callerPeer===socket.peer ||
        (call.calleePeer && call.calleePeer===socket.peer))
        finish(call,"disconnected");
  };
  return {handle,authorized,disconnected};
}
