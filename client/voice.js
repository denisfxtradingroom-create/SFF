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
  deaf = false,
  mic = "",
  cam = "",
  speaker = "",
  generation = 0;
const peers = new Map(),
  pending = new Map();
const button = (a, t) => '<button data-a="voice-' + a + '">' + t + "</button>";
function mount() {
  stopMeters();
  const el = document.querySelector("#voice");
  if (!el) return;
  el.innerHTML =
    '<p class="eyebrow">SIGNAL / GLASOVNI KANAL</p><h2>' +
    (active ? "U razgovoru" : "Glasovna soba") +
    '</h2><p class="muted">' +
    (active
      ? "Učesnici u sobi · " + (peers.size + 1)
      : "Uključi mikrofon da se pridružiš razgovoru.") +
    '</p><hr><div class="row">' +
    (active
      ? button(
          "mute",
          stream.getAudioTracks()[0]?.enabled
            ? "Isključi mikrofon"
            : "Uključi mikrofon",
        ) +
        button("deafen", deaf ? "Uključi zvuk" : "Isključi zvuk") +
        button("camera", video ? "Zaustavi video" : "Kamera") +
        (navigator.mediaDevices?.getDisplayMedia
          ? button("screen", "Podeli ekran")
          : "") +
        button("devices", "Uređaji") +
        button("leave", "Napusti")
      : button("join", "Pridruži se")) +
    '</div><div class="grid"></div>';
  const grid = el.querySelector(".grid");
  if (active) {
    const tile = (media, label, local, id) => {
      const wrap = document.createElement("div"),
        vid = document.createElement("video"),
        p = document.createElement("p");
      vid.autoplay = true;
      vid.playsInline = true;
      vid.muted = local || deaf;
      vid.srcObject = media;
      if (!local && speaker && vid.setSinkId)
        vid.setSinkId(speaker).catch(() => {});
      p.textContent = label;
      wrap.append(vid, p);
      if (!local) {
        const volume = document.createElement("input");
        volume.type = "range";
        volume.min = 0;
        volume.max = 1;
        volume.step = 0.05;
        volume.value = peers.get(id).volume;
        vid.volume = Number(volume.value);
        volume.setAttribute("aria-label", "Jačina zvuka " + label);
        volume.oninput = () =>
          (peers.get(id).volume = vid.volume = Number(volume.value));
        wrap.append(volume);
      }
      grid.append(wrap);
      if (media.getAudioTracks().length && audioContext) {
        const source = audioContext.createMediaStreamSource(media),
          meter = audioContext.createAnalyser();
        meter.fftSize = 256;
        source.connect(meter);
        source.meter = meter;
        source.label = p;
        meters.push(source);
      }
    };
    tile(
      new MediaStream([...stream.getAudioTracks(), ...(video ? [video] : [])]),
      "Ti",
      true,
    );
    for (const [id, p] of peers) tile(p.media, "Član #" + p.uid, false, id);
    if (meters.length) {
      const bytes = new Uint8Array(256);
      meterTimer = setInterval(() => {
        for (const s of meters) {
          s.meter.getByteTimeDomainData(bytes);
          s.label.classList.toggle(
            "speaking",
            bytes.some((v) => Math.abs(v - 128) > 12),
          );
        }
      }, 160);
    }
  }
}
export function voice() {
  mount();
}
function connection(peer, uid, initiator) {
  const pc = new RTCPeerConnection({ iceServers: ice }),
    media = new MediaStream();
  const state = { pc, media, uid, volume: 1 };
  peers.set(peer, state);
  pc.onicecandidate = (e) => {
    if (e.candidate && active)
      sendVoice({
        type: "signal",
        room: active,
        peer,
        data: { candidate: e.candidate },
      });
  };
  pc.ontrack = (e) => {
    media.addTrack(e.track);
    e.track.onunmute = mount;
    mount();
  };
  pc.addTrack(stream.getAudioTracks()[0], stream);
  if (initiator) {
    state.sender = pc.addTransceiver("video", { direction: "sendrecv" }).sender;
    if (video) state.sender.replaceTrack(video);
  }
  return state;
}
export async function voiceEvent(e) {
  if (!["peers", "signal", "left"].includes(e.type)) return false;
  if (!active) return true;
  const signal = (peer, data) =>
    sendVoice({ type: "signal", room: active, peer, data });
  if (e.type === "peers") {
    ice = e.ice;
    for (const p of e.peers) {
      const { pc } = connection(p.peer, p.uid, true);
      await pc.setLocalDescription(await pc.createOffer());
      signal(p.peer, { description: pc.localDescription });
    }
  }
  if (e.type === "left") {
    peers.get(e.peer)?.pc.close();
    peers.delete(e.peer);
    pending.delete(e.peer);
    mount();
  }
  if (e.type === "signal") {
    const d = e.data;
    let p = peers.get(e.peer);
    if (d.candidate) {
      if (p?.pc.remoteDescription) await p.pc.addIceCandidate(d.candidate);
      else pending.set(e.peer, [...(pending.get(e.peer) || []), d.candidate]);
      return true;
    }
    if (!p) p = connection(e.peer, e.uid, false);
    await p.pc.setRemoteDescription(d.description);
    for (const c of pending.get(e.peer) || []) await p.pc.addIceCandidate(c);
    pending.delete(e.peer);
    if (d.description.type === "offer") {
      p.sender = p.pc
        .getTransceivers()
        .find((t) => t.receiver.track.kind === "video")?.sender;
      if (p.sender) {
        p.pc.getTransceivers().find((t) => t.sender === p.sender).direction =
          "sendrecv";
        await p.sender.replaceTrack(video);
      }
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      signal(e.peer, { description: p.pc.localDescription });
    }
    mount();
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
