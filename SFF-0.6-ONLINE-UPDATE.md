# SFF 0.6 – ONLINE notification update (Android + Windows, no install)

## Features implemented in feature branch
- Backend pushes authenticated `friend_request` event ONLY to the recipient, including the sender's display name and username.
- The sender gets `friend_accepted` after acceptance.
- Existing `state` websocket refresh still updates users, friends and messages.
- Incoming friend request is visible as a persistent number on the "Prijatelji" and mobile "Poruke" buttons even after reopening the app, without first opening "Prijatelji".
- Pending requests sort to the top of the existing Friends modal.
- One notification path (previous native double alert removed), foreground in-app banner with SFF brand, desktop Web Notification and Android WebView bridge.
- Notification center with last 30 event titles/times per account on the current device; "Prijateljski zahtevi", "Obriši istoriju", close.
- Separate notification toggles for messages and friend requests/acceptance; preview ON/OFF, in-app banners, quiet mode.
- Foreground sound themes: SFF Classic, Soft, Digital; volume 0–100%; sound test buttons; Web Audio obeys user-gesture/autoplay restrictions.
- Native Android OS notification icon and channel sound CANNOT be changed by online JavaScript. They require a rebuilt and reinstalled APK. This release intentionally does not modify any native wrapper.
- Background notification while Android app is force-stopped/killed requires FCM and native integration and is NOT supported by this web-only release.

## BLOCKER: do not merge or deploy until production data is protected
GitHub Actions `SFF production database safety check` called
`https://sff-signal-api.onrender.com/health` and got
`{"ok":true,"database":"local"}`.

Therefore the production app currently uses local SQLite inside a Render **Free** service. Render documents that Free services are ephemeral: local changes/databases are lost on restart, redeploy or spin-down. Render Free has no SSH or Dashboard Shell.

This is already a severe issue for the current live community and must be resolved before deploying 0.6. A merge may automatically trigger the Render deployment and destroy in-memory/local accounts and messages. DO NOT MERGE THIS BRANCH YET.

Official docs:
https://render.com/docs/free
https://render.com/docs/ssh

## Safe prerequisite
1. Preserve/export the existing live SQLite file **before** any restart or deploy, using an authorized mechanism available on the running instance. No such mechanism is currently accessible via the Render connector. Upgrading Render may restart the service; do not assume it will preserve the existing ephemeral filesystem.
2. Restore/migrate existing data to a durable external database such as Turso. Use `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` stored only in Render Environment, never in GitHub or chats.
3. Confirm `/health` returns `database:"turso"`, ensure a test user's messages survive a controlled restart and that backups are working.
4. Merge this PR, let Render deploy 0.6 online, test Android and Windows users who already have SFF installed. No new APK/EXE is needed for these frontend/backend changes.

## Automated tests
`SFF CI` runs node --check for all scripts including social-notifications.js, plus backend integration, email mock and advanced media tests. New integration checks friend request event, sender identity, pending state and acceptance notification.

Do not confuse CI passing with device push-notification testing. Foreground WebView/background OS behavior still requires tests on actual Android and Windows devices.
