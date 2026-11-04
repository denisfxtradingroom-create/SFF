import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";

const root = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
for (const name of [
  "client/profile-crop.js", "client/sff-next.js",
  "client/app.js", "client/social-wall.js", "client/voice.js"
]) {
  const result = spawnSync(process.execPath, ["--check", new URL(name, root).pathname],{
    encoding:"utf8",timeout:10000
  });
  assert.equal(result.status, 0, name+": "+result.stderr);
}

const crop = read("client/profile-crop.js");
const window = {};
runInNewContext(crop, {window});
assert.equal(typeof window.SFFCropImage, "function");
await assert.rejects(
  window.SFFCropImage({type:"image/jpeg",size:4},"unsafe"),
  /Nepoznata vrsta/
);
await assert.rejects(
  window.SFFCropImage({type:"image/svg+xml",size:4},"avatar"),
  /JPG ili PNG/
);
await assert.rejects(
  window.SFFCropImage({type:"image/jpeg",size:13*1024*1024},"banner"),
  /12 MB/
);
assert(crop.includes("canvas.toBlob") && crop.includes("ctx.drawImage"),
  "Images must be rendered into a bounded canvas, not uploaded as uncropped originals");
assert(crop.includes("pointermove") && crop.includes('type="range"'),
  "Cover and avatar need a pan/zoom preview before upload");
assert(crop.includes("maxUploadBytes"),"Image must meet the existing upload limit");

const html=read("client/index.html");
assert(html.indexOf('src="/profile-crop.js"')>=0);
assert(html.indexOf('src="/profile-crop.js"') < html.indexOf('src="/sff-next.js"'),
  "Crop editor must be loaded before the profile change handler");
const css=read("client/sff-next.css");
assert(css.includes(".sffProfileDialog .sffV5AvatarClip") &&
  css.includes("overflow: hidden"),
  "Avatar art must be constrained to its own overflow-clipped box");
assert(css.includes(".sffProfileDialog .sffV5AvatarClip > img") &&
  css.includes("object-fit: cover"),
  "Tall portraits must never expand the displayed avatar");
const profile=read("client/sff-next.js");
assert(profile.includes('await window.SFFCropImage(file, slot)'));
assert(profile.includes("photoRevisions"),"Profile artwork should not reload on every open");
assert(profile.includes('photoRevisions.set(profileId + ":" + slot, Date.now())'));

const app=read("client/app.js");
assert(app.includes("const authoredShellParts = new Map()") &&
  app.includes("authoredShellParts.get(selector)"),
  "Authored shell snapshots must prevent third-party decorations from triggering repaint");
assert(app.includes("const authoredFeedNodes = new WeakMap()") &&
  app.includes("authoredFeedNodes.get(existing)"),
  "New messages must not destroy old audio/video playback nodes");
assert(app.includes("updated.some((node, i) => node !== existing[i])"),
  "Do not replace all chat DOM children when none changed");
assert(app.includes('a === "callFree"') &&
  app.includes("crypto.getRandomValues") &&
  app.includes("https://meet.jit.si/SFF-") &&
  app.includes('await api("post"'),
  "Free fallback must use an unpredictable private chat invite, not paid TURN");

const wall=read("client/social-wall.js");
assert(wall.includes("const postDomState=new WeakMap()") &&
  wall.includes("postStaticKey") &&
  wall.includes("el.replaceChildren(...next)") &&
  wall.includes('feed=feed.map(p=>p.id===item.id?item:p);\n        draw();'),
  "Reacting to a post must preserve unchanged post cards");
const voice=read("client/voice.js");
assert(voice.includes("if (controls.innerHTML !== buttonMarkup)") &&
  voice.includes("if (status.textContent !== connectionLabel)"),
  "WebRTC status updates must not tear down call controls");

console.log("SFF profile: crop/zoom, avatar bounds, stable chat/feed, free call fallback PASS");
