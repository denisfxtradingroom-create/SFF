# SFF · Signal — 0.3 Production Base

SFF je Windows + Android communication/community klijent sa Node.js backendom, real-time WebSocket porukama i WebRTC signalingom. Production arhitektura je **Windows/Android → Render backend → Turso**, uz Resend za email verifikaciju i reset lozinke.

## Registracija

SFF odvaja prikazno ime od jedinstvenog handle-a:

- `firstName`: ime, npr. `Denis`
- `lastName`: prezime, npr. `Dudas`
- `username`: jedinstveni handle bez razmaka, npr. `denisdudas`
- `email` + `emailConfirm`
- `password` + `passwordConfirm`

Kada je `SFF_REQUIRE_VERIFIED_EMAIL=1`, korisnik dobija jednokratni email kod koji važi 15 minuta. Dok ga ne potvrdi, aplikacija ne dozvoljava normalno korišćenje naloga. Reset lozinke poništava stare sesije.

## Baza

`backend/db.mjs` daje jedan asinhroni DB sloj:

- local/test: Node `node:sqlite`
- production: `@tursodatabase/serverless/compat` i Turso Cloud kada su postavljeni `TURSO_DATABASE_URL` i `TURSO_AUTH_TOKEN`

Turso credentials pripadaju samo backendu. Nikada ih ne ugrađuj u APK/EXE ili source repo. Bez Turso baze Render Free gubi naloge pri restartu. Uputstvo za bezbedno povezivanje: [TURSO-TRAJNA-BAZA.md](TURSO-TRAJNA-BAZA.md).

## Production env

```dotenv
HOST=0.0.0.0
SFF_HTTPS=1
SFF_REQUIRE_VERIFIED_EMAIL=1
SFF_REQUIRE_DURABLE_DB=1
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
RESEND_API_KEY=...
SFF_MAIL_FROM=SFF <noreply@example.com>
SFF_ICE=[]
```

`GET /health` vraća tip aktivne baze. Na production instanci mora da vrati:

```json
{"ok":true,"database":"turso"}
```

## Render

Repo sadrži `render.yaml`. Build komanda instalira production dependency, a start komanda je:

```bash
node backend/server.mjs
```

Deploy je u Frankfurt regionu po blueprint-u. Secret vrednosti se unose kao Render environment variables i ne commituju se.

## Windows i Android build

GitHub workflow `.github/workflows/build.yml` očekuje Repository Variable:

```text
SFF_PUBLIC_URL=https://tvoj-sff-backend.onrender.com
```

Ta adresa se ugrađuje direktno u oba klijenta. Production korisnik ne unosi server adresu.

Artifacts:

- `SFF-Setup.exe` — Windows
- `SFF-Android.apk` — Android, min API 28 / target 36

Windows production build ne bundluje lokalni Node backend kada je `SFF_PUBLIC_URL` postavljen. Android debug/local režim i dalje zadržava development mogućnost, ali production APK odmah otvara ugrađeni HTTPS origin.

## Testovi

```bash
npm test
```

Integracioni test pokriva dva korisnika, friends/DM, WebSocket delivery, communities, channels, permissions, attachments, message edit/reaction/pin/thread, voice signaling, reconnect, block, logout/login i restart. Email test pokriva obaveznu verifikaciju, jednokratni reset kod, opoziv sesija i prijavu novom lozinkom.

## Voice/video

Poruke i chat rade nezavisno od TURN-a. Za pouzdan WebRTC voice/video između mobilnih mreža i restriktivnih NAT-ova postavi TURN u `SFF_ICE`. Sam STUN nije garancija da će svaki par korisnika moći da uspostavi direktnu vezu.

Detaljno praktično uputstvo je u `UPUTSTVO.txt`.
