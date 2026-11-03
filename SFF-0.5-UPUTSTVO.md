# SFF 0.5 — novi online update (Android + Windows)

## Automatski update
SFF 0.4 Android APK i postojeći Windows WebView2 klijent otvaraju istu HTTPS aplikaciju na Render-u. Izmene u client/ i backend/ važe za oba sistema kada korisnik ponovo otvori ili osveži SFF. Ne zahteva novu instalaciju za ovaj online UI update. Native promene (.apk/.exe) i dalje zahtevaju novu instalaciju; APK potpis mora biti isti za in-place update.

## Nove mogućnosti
- Checkbox "Ostani prijavljen" na registraciji i login-u: označeno = persistent cookie (90 dana) i DB session; isključeno = session cookie i kraći DB session.
- Jedinstveni @username i proveravanje zauzetog imena i prezimena za prikaz.
- Nov profil sa bannerom, avatarom, bio/statusom, privatnošću, promenom lozinke i odjavom.
- Indikatori prisustva; server razlikuje aktivnu konekciju od offline naloga.
- Glasovne poruke kroz MediaRecorder/GetUserMedia (maksimalno 2 minuta / 5 MB); audio/webm/audio/ogg/audio/mp4/audio/mpeg, uz autorizaciju i HTTP Range streaming.
- Brisanje razgovora rešeno na server-side /api/state, ne samo CSS sakrivanje. Briše se samo korisnikov pogled na prethodnu istoriju; drugi učesnik čuva svoje poruke. Nova poruka ponovo prikazuje razgovor, ali ne prethodno obrisane poruke.
- Unread count po korisniku uzima u obzir granicu brisanja razgovora.

## Aktivacija pravog emaila (NIJE završena samim GitHub deployem)
Backend ima Resend OTP (rok 15 minuta, single-use), a verifikacija postaje obavezna automatski kada su postavljena oba env var na Render servisu:
- RESEND_API_KEY = Send-only Resend API key
- SFF_MAIL_FROM = verifikovan sender, npr. SFF <no-reply@vlasnicki-domen.rs>
Verifikuj domen na Resend nalogu, pa otvori Render > sff-signal-api > Environment i bezbedno dodaj vrednosti. Nikada ne šalji API key u chat niti GitHub repo.
Ako ta dva podatka NISU postavljena, SFF ne može poslati stvarni email kod i verifikacija nije aktivna. Podešavanje samo SFF_REQUIRE_VERIFIED_EMAIL=1 bez sender kredencijala blokira novu registraciju — ne radi to.
Nakon podešavanja probaj sa NOVIM test nalogom i proveri inbox, spam i Resend delivery logs.

## Trajna baza
Render proces nije stabilna baza za naloge/poruke na free hostingu. Render > Environment mora sadržati TURSO_DATABASE_URL i TURSO_AUTH_TOKEN za remote Turso; /health odgovara database=turso kada je udaljena baza aktivna. Bez toga podaci mogu nestati posle restarta ili deploya.

## Preporučeni test na dva telefona i računaru
1. Otvori postojeći SFF Android/Windows i osveži.
2. Prijavi se sa označenim/isključenim ostani prijavljen, proveri zatvaranje i ponovno pokretanje.
3. Otvori profil, postavi PNG/JPG za avatar i banner, promeni status Online.
4. Pošalji glasovnu, preslušaj na drugom uređaju.
5. Obriši privatni chat na nalogu A, uveri se da ga nalog B još ima; pošalji novu poruku sa B i proveri da A vidi samo novu poruku.
6. Tek nakon postavljanja Resend tajni proveri registraciju i obaveznu potvrdu emaila.

## Bezbednost i granice
- Web UI može da se updateuje automatski, ali Android se ne sme bez odobrenja korisnika sam tiho preinstalirati.
- Notifikacije na starom WebView wrapperu stižu dok je aktivna WebView/WebSocket konekcija; za pouzdane notifikacije kada je aplikacija ugašena treba Android FCM/push i sistemski servis (posebna native izmena).
- Voice recording zavisi od dozvole za mikrofon i podrške MediaRecorder u konkretnom Android System WebView-u.
- Pre produkcije potrebna su realna testiranja Android/Windows interfejsa i stres-testovi.
