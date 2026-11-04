import { sendVoice } from "./app.js";
export const activeVoiceRoom = () => active;
let meterTimer, audioContext;
const meters = [];
function stopMeters() {
  clearInterval(meterTimer);
  for (const source of meters) source.disconnect();
  meters.length = 0;
}
let active = null,
  stream = null,
  video = null,
  ice = [],
  iceMode = "default",
  deaf = false,
  mic = "",
  cam = "",
  speaker = "",
  generation = 0;
const peers = new Map(),
  pending = new Map(),
  signalQueues = new Map();
const button = (a, t) => '<button data-a="voice-' + a + '">' + t + "</button>";
// Preserve media elements across track, volume and connection updates.
// Rebuilding a playing <video> discards its playback state on WebView/Android.
function mount() {
  stopMeters();
  const el = document.querySelector("#voice");
  if (!el) return;
  let info = el.querySelector("[data-voice-info]");
  let controls = el.querySelector("[data-voice-controls]");
  let grid = el.querySelector(".grid");
  if (!info || !controls || !grid) {
    el.innerHTML = '<div data-voice-info></div><hr><div class="row" data-voice-controls></div>' +
      '<div class="grid"></div>';
    info = el.querySelector("[data-voice-info]");
    controls = el.querySelector("[data-voice-controls]");
    grid = el.querySelector(".grid");
  }
  const states = [...peers.values()];
  const connected = states.some((p) =>
    p.pc.connectionState === "connected" || p.pc.iceConnectionState === "completed");
  const failed = states.some((p) =>
    p.pc.connectionState === "failed" || p.pc.iceConnectionState === "failed");
  const connectionLabel = !active ? "Uključi mikrofon da se pridružiš razgovoru." :
    failed ? (iceMode === "stun_only"
      ? "Medijska veza nije uspela. TURN relay još nije povezan."
      : "Medijska veza nije uspela. Proveri TURN ili mrežne postavke.") :
    !states.length ? "Čekamo drugog učesnika…" :
    connected ? "Zvuk i video su povezani." :
    "Povezivanje zvuka i videa…" + (iceMode === "turn" ? " (TURN relay spreman)" : "");
  info.innerHTML = '<p class="eyebrow">SIGNAL / GLASOVNI KANAL</p><h2>' +
    (active ? "U razgovoru" : "Glasovna soba") +
    '</h2><p class="muted" data-voice-status>' + connectionLabel + '</p>';
  controls.innerHTML = active
    ? button("mute", stream?.getAudioTracks()[0]?.enabled
      ? "Isključi mikrofon" : "Uključi mikrofon") +
      button("deafen", deaf ? "Uključi zvuk" : "Isključi zvuk") +
      button("camera", video ? "Zaustavi video" : "Kamera") +
      (navigator.mediaDevices?.getDisplayMedia ? button("screen", "Podeli ekran") : "") +
      button("devices", "Uređaji") + button("leave", "Napusti")
    : button("join", "Pridruži se");
  if (!active || !stream) {
    grid.replaceChildren();
    return;
  }

  const used = new Set();
  const tile = (media, label, local, peerId) => {
    const key = local ? "local" : "peer-" + peerId;
    used.add(key);
    let wrap = [...grid.children].find((node) => node.dataset.voicePeer === key);
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.dataset.voicePeer = key;
      const player = document.createElement("video");
      const caption = document.createElement("p");
      const resume = document.createElement("button");
      resume.type = "button";
      resume.textContent = "Pokreni zvuk/video";
      resume.hidden = true;
      player.autoplay = true;
      player.playsInline = true;
      resume.onclick = () => {
        const promise = player.play();
        promise?.then(() => { resume.hidden = true; })
          .catch(() => { resume.hidden = false; });
      };
      wrap.append(player, caption, resume);
      if (!local) {
        const volume = document.createElement("input");
        volume.type = "range";
        volume.min = 0;
        volume.max = 1;
        volume.step = 0.05;
        volume.setAttribute("aria-label", "Jačina zvuka " + label);
        volume.oninput = () => {
          const peer = peers.get(peerId);
          if (peer) peer.volume = Number(volume.value);
          player.volume = Number(volume.value);
        };
        wrap.append(volume);
      }
      grid.append(wrap);
    }
    const player = wrap.querySelector("video");
    const caption = wrap.querySelector("p");
    const resume = wrap.querySelector("button");
    caption.textContent = label;
    player.muted = local || deaf;
    if (local) {
      // Keep the same element, and only update srcObject when tracks change.
      const wanted = [...stream.getAudioTracks(), ...(video ? [video] : [])];
      const have = player.srcObject?.getTracks() || [];
      if (wanted.length !== have.length || wanted.some((track,i) => track !== have[i]))
        player.srcObject = new MediaStream(wanted);
    } else {
      if (player.srcObject !== media) player.srcObject = media;
      const volume = wrap.querySelector('input[type="range"]');
      const wantedVolume = peers.get(peerId)?.volume ?? 1;
      if (volume) volume.value = String(wantedVolume);
      player.volume = wantedVolume;
      if (speaker && player.setSinkId && player.sinkId !== speaker)
        player.setSinkId(speaker).catch(() => {});
    }
    if (player.paused && player.srcObject?.active) {
      const promise = player.play();
      promise?.then(() => { resume.hidden = true; })
        .catch(() => { resume.hidden = false; });
    }
    if (media.getAudioTracks().length && audioContext) {
      const source = audioContext.createMediaStreamSource(media);
      const meter = audioContext.createAnalyser();
      meter.fftSize = 256;
      source.connect(meter);
      source.meter = meter;
      source.label = caption;
      meters.push(source);
    }
  };
  tile(new MediaStream([...stream.getAudioTracks(), ...(video ? [video] : [])]), "Ti", true);
  for (const [id, p] of peers) tile(p.media, "Član #" + p.uid, false, id);
  for (const node of [...grid.children])
    if (!used.has(node.dataset.voicePeer)) node.remove();
  if (meters.length) {
    const bytes = new Uint8Array(256);
    meterTimer = setInterval(() => {
      for (const source of meters) {
        source.meter.getByteTimeDomainData(bytes);
        source.label.classList.toggle("speaking",
          bytes.some((v) => Math.abs(v - 128) > 12));
      }
    }, 160);
  }
}

export function voice() {
  mount();
}
function connection(peer, uid, initiator) {
  const pc = new RTCPeerConnection({ iceServers: ice });
  const media = new MediaStream();
  const state = { pc, media, uid, volume: 1, initiator, restarts: 0 };
  peers.set(peer, state);
  pc.onconnectionstatechange = () => mount();
  pc.oniceconnectionstatechange = () => {
    mount();
    // One ICE restart may recover from temporary network changes.
    // If no candidate pair works, TURN is still required for some networks.
    if (pc.iceConnectionState !== "failed" || !initiator ||
        state.restarts >= 1 || pc.signalingState !== "stable" || !active) return;
    state.restarts++;
    void (async () => {
      await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
      sendVoice({
        type: "signal", room: active, peer,
        data: { description: pc.localDescription },
      });
    })().catch(() => mount());
  };
  pc.onicecandidate = (e) => {
    if (!e.candidate || !active || pc.signalingState === "closed") return;
    try {
      sendVoice({
        type: "signal", room: active, peer,
        data: { candidate: e.candidate },
      });
    } catch { /* A closed call must never resurrect the WebSocket. */ }
  };
  pc.ontrack = (e) => {
    if (!media.getTracks().includes(e.track)) media.addTrack(e.track);
    e.track.onunmute = mount;
    e.track.onended = mount;
    mount();
  };
  pc.addTrack(stream.getAudioTracks()[0], stream);
  if (initiator) {
    state.sender = pc.addTransceiver("video", { direction: "sendrecv" }).sender;
    if (video) void state.sender.replaceTrack(video);
  }
  mount();
  return state;
}
async function applySignal(e) {
  if (!active) return;
  const d = e.data;
  if (!d || (!d.candidate && !d.description)) return;
  let p = peers.get(e.peer);
  if (d.candidate) {
    if (p?.pc.remoteDescription) await p.pc.addIceCandidate(d.candidate);
    else pending.set(e.peer, [...(pending.get(e.peer) || []), d.candidate]);
    return;
  }
  if (!p) p = connection(e.peer, e.uid, false);
  const pc = p.pc;
  if (pc.signalingState === "closed") return;
  // Socket events are asynchronous; serializing per peer prevents candidates
  // arriving in the middle of setRemoteDescription().
  await pc.setRemoteDescription(d.description);
  for (const candidate of pending.get(e.peer) || [])
    await pc.addIceCandidate(candidate);
  pending.delete(e.peer);
  if (d.description.type === "offer") {
    const transceiver = pc.getTransceivers().find(
      (t) => t.receiver.track.kind === "video"
    );
    if (transceiver) {
      transceiver.direction = "sendrecv";
      p.sender = transceiver.sender;
      await p.sender.replaceTrack(video);
    }
    await pc.setLocalDescription(await pc.createAnswer());
    sendVoice({
      type: "signal", room: active, peer: e.peer,
      data: { description: pc.localDescription },
    });
  }
  mount();
}
export async function voiceEvent(e) {
  if (!["peers", "signal", "left"].includes(e.type)) return false;
  if (!active) return true;
  if (e.type === "peers") {
    ice = Array.isArray(e.ice) ? e.ice : [];
    iceMode = typeof e.iceMode === "string" ? e.iceMode : "default";
    for (const other of e.peers) {
      const { pc } = connection(other.peer, other.uid, true);
      await pc.setLocalDescription(await pc.createOffer());
      sendVoice({
        type: "signal", room: active, peer: other.peer,
        data: { description: pc.localDescription },
      });
    }
  } else if (e.type === "left") {
    peers.get(e.peer)?.pc.close();
    peers.delete(e.peer);
    pending.delete(e.peer);
    signalQueues.delete(e.peer);
    mount();
  } else if (e.type === "signal") {
    const currentGeneration = generation;
    const previous = signalQueues.get(e.peer) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (generation === currentGeneration && active) await applySignal(e);
    });
    signalQueues.set(e.peer, next);
    try {
      await next;
    } finally {
      if (signalQueues.get(e.peer) === next) signalQueues.delete(e.peer);
    }
  }
  return true;
}

export function voiceLeave() {
  generation++;
  stopMeters();
  audioContext?.close().catch(() => {});
  audioContext = null;
  if (active)
    try {
      sendVoice({ type: "leave" });
    } catch {}
  active = null;
  for (const p of peers.values()) p.pc.close();
  peers.clear();
  pending.clear();
  signalQueues.clear();
  iceMode = "default";
  stream?.getTracks().forEach((t) => t.stop());
  video?.stop();
  video = stream = null;
  deaf = false;
  mount();
}
async function setVideo(t) {
  const prev = video;
  video = t;
  await Promise.all([...peers.values()].map((p) => p.sender?.replaceTrack(t)));
  prev?.stop();
  if (t) t.onended = () => setVideo(null);
  mount();
}
export async function voiceAction(a, room) {
  if (a === "join") {
    if (!navigator.mediaDevices)
      throw Error("Mikrofon zahteva HTTPS ili localhost.");
    const n = generation;
    const s = await navigator.mediaDevices.getUserMedia({
      audio: {
        noiseSuppression: true,
        echoCancellation: true,
        deviceId: mic || undefined,
      },
    });
    if (n !== generation) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = s;
    active = room;
    audioContext = new AudioContext();
    audioContext.resume().catch(() => {});
    try {
      sendVoice({ type: "voice", room });
    } catch (e) {
      voiceLeave();
      throw e;
    }
  }
  if (a === "leave") return voiceLeave();
  if (a === "mute") {
    const t = stream.getAudioTracks()[0];
    t.enabled = !t.enabled;
  }
  if (a === "deafen") deaf = !deaf;
  if (a === "camera" || a === "screen") {
    if (video && a === "camera") await setVideo(null);
    else {
      const s =
        a === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({ video: true })
          : await navigator.mediaDevices.getUserMedia({
              video: { deviceId: cam || undefined },
            });
      await setVideo(s.getVideoTracks()[0]);
    }
  }
  if (a === "devices") {
    const devices = await navigator.mediaDevices.enumerateDevices(),
      dlg = document.querySelector("#dialog");
    dlg.innerHTML = "<h2>Uređaji</h2>";
    for (const [kind, label] of [
      ["audioinput", "Mikrofon"],
      ["videoinput", "Kamera"],
      ["audiooutput", "Zvučnik"],
    ]) {
      if (kind === "audiooutput" && !HTMLMediaElement.prototype.setSinkId)
        continue;
      const l = document.createElement("label"),
        s = document.createElement("select");
      l.textContent = label;
      for (const d of devices.filter((x) => x.kind === kind))
        s.add(new Option(d.label || label, d.deviceId));
      l.append(s);
      dlg.append(l);
      s.onchange = async () => {
        try {
          if (kind === "audiooutput") speaker = s.value;
          else if (kind === "videoinput") {
            cam = s.value;
            if (video)
              await setVideo(
                (
                  await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: cam },
                  })
                ).getVideoTracks()[0],
              );
          } else {
            mic = s.value;
            const old = stream.getAudioTracks()[0],
              next = (
                await navigator.mediaDevices.getUserMedia({
                  audio: { deviceId: mic, noiseSuppression: true },
                })
              ).getAudioTracks()[0];
            next.enabled = old.enabled;
            for (const p of peers.values())
              await p.pc
                .getSenders()
                .find((x) => x.track?.kind === "audio")
                ?.replaceTrack(next);
            stream.removeTrack(old);
            old.stop();
            stream.addTrack(next);
          }
          mount();
        } catch (e) {
          l.append(document.createTextNode(e.message));
        }
      };
    }
    const ok = document.createElement("button");
    ok.textContent = "Gotovo";
    ok.onclick = () => dlg.close();
    dlg.append(ok);
    dlg.showModal();
  }
  mount();
}
