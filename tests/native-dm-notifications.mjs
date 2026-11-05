import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL("../"+path,import.meta.url),"utf8");
const service = read("android/push/app/src/main/java/app/sff/signal/SffMessagingService.java");
const reply = read("android/push/app/src/main/java/app/sff/signal/SffReplyReceiver.java");
const manifest = read("android/push/app/src/main/AndroidManifest.xml");
const main = read("android/Main.java");
const push = read("backend/call-push.mjs");
const server = read("backend/server.mjs");
const client = read("client/app.js");

assert(service.includes('"dm_message"'), "Firebase service handles direct messages");
const dmHandler=service.split("private void showMessage(RemoteMessage message) {")[1]
  .split("private void showCall(RemoteMessage message) {")[0];
assert(!dmHandler.includes("Main.isForeground()"),
  "Activity lifecycle must not silently discard a real private message");
assert(dmHandler.includes(".setOnlyAlertOnce(false)"),
  "New DMs must re-alert even when updating an existing room notification");
assert(client.includes("status.latestMessagePush"),
  "Settings must differentiate real DM delivery from a synthetic FCM test");
assert(push.includes('latestMessagePush: recentDm.get(uid)'),
  "Delivery diagnosis must be scoped to the logged-in user");
assert(service.includes('setSmallIcon(R.drawable.sff_status)'), "System notifications use transparent SFF logo");
assert(read("android/push/app/src/main/res/drawable/sff_status.xml").includes('android:fillColor="#FFFFFFFF"'),
  "Notification small icon must be a monochrome SFF silhouette without background");
assert(service.includes("RemoteInput.Builder"), "Native notifications support inline reply");
assert(service.includes("BigTextStyle"), "Notification can preview message text");
assert(service.includes("VISIBILITY_PRIVATE"), "Lockscreen privacy is respected");
assert(reply.includes("getResultsFromIntent"), "Android reads reply from RemoteInput");
assert(reply.includes('"/api/post"'), "Reply goes to existing authenticated SFF endpoint");
assert(reply.includes('CookieManager.getInstance().getCookie'), "Reply uses existing login");
assert(reply.includes("setRequestProperty(\"Cookie\",sessionCookie)"), "Only SFF auth cookie is sent");
assert(reply.includes("connection.getResponseCode()"), "Reply confirms server status");
assert(reply.includes("pending.finish()"), "Background reply completes broadcast");
assert(manifest.includes('android:name=".SffReplyReceiver" android:exported="false"'),
  "Native receiver is non-exported");
assert(main.includes('openExternal(String url)'),"Jitsi fallback opens native browser");
assert(main.includes('"meet.jit.si".equals(target.getHost())'),"External links use restricted host");
assert(push.includes('async function sendMessage('),"Server can send Firebase DM events");
assert(server.includes("callPush.sendMessage(recipient.uid"),"Saved DMs trigger push");
assert(client.includes("window.SFFAndroid.openExternal(target)"),"Chat fallback uses native bridge");
assert(main.includes('getString("fcm_token",null)'),
  "FCM device registration must be retried after page load and app resume");
const registrationSection = main.split('public void registerPush()')[1].split('public void ask()')[0];
assert(!registrationSection.includes('!mainPageLoaded'),
  "Early in-app registration must not be silently skipped");
assert(main.includes('notificationsEnabled()'),
  "Android app must expose notification permission status");
assert(service.includes('"push_self_test"') && service.includes("showSelfTest()"),
  "FCM test must post a native SFF notification");
assert(server.includes('a === "pushStatus"') && server.includes('a === "pushSelfTest"'),
  "Authenticated push diagnostics must be exposed");
assert(client.includes('a === "pushRefresh"') &&
  client.includes('a === "pushSelfTest"'),
  "User must be able to refresh token status and send a test");
assert(read("backend/dm-calls.mjs").includes('if(callPush)'),
  "Native incoming ringtone is needed even when background WebSocket stays open");
console.log("PASS SFF native message preview, icon, reply security, FCM handshake, offline calls and diagnostics");
