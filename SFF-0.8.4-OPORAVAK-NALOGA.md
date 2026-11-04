# SFF 0.8.4 — Oporavak pristupa nalogu

## Dve opcije na ekranu za prijavu
- **Zaboravljena lozinka** — zatraži kod na registrovanu e-poštu, zatim postavi novu lozinku. Kod traje 15 minuta i može se iskoristiti samo jednom. Sve prethodne sesije se odjavljuju.
- **Zaboravljeno korisničko ime** — na registrovanu e-poštu stiže @korisničko_ime. Nema potrebe da osoba zna staro korisničko ime da bi ga povratila.
- Obe opcije vidljive su na Androidu i Windowsu čak i kada e-pošta još nije aktivirana, ali aplikacija tada **jasno kaže da slanje mejlova nije podešeno**. Ne tvrdi da su poruke poslate.
- Oporavak ne prikazuje da li e-pošta pripada registrovanom korisniku u običnom API odgovoru. Brzina odziva može varirati; slanje i ograničavanje zahteva ostaju pod nadzorom servera.
- Ne menja se postojeći način logovanja, jedinstvenost @username/e-pošte, prijatelji, poruke, zid ili Turso baza.
- Uključivanje poštanskog servisa **ne nameće** obaveznu potvrdu e-pošte svim postojećim nalozima. Za obaveznu verifikaciju posebno se koristi `SFF_REQUIRE_VERIFIED_EMAIL=1`.

## Da bi oporavak stvarno slao mejlove
SFF koristi **Resend** kao postojeći transakcioni mejl servis. Administrator u **Render → sff-signal-api → Environment** podešava:
- `RESEND_API_KEY` = privatni Resend API ključ
- `SFF_MAIL_FROM` = adresa pošiljaoca sa potvrđenog domena, npr. `SFF <noreply@tvoj-domen.example>`
- `SFF_REQUIRE_VERIFIED_EMAIL` = `0` ako želiš samo oporavak bez obavezne potvrde novih naloga; `1` samo ako namerno želiš i verifikaciju e-pošte.

**Ne unositi tajne u chat, GitHub, JavaScript ili APK.** Potrebno je proveriti sender domen u Resend panelu da bi poruke stizale i drugim ljudima, ne samo vlasniku naloga. Posle podešavanja Render može ponovo pokrenuti servis; Turso podaci ostaju sačuvani.

## Test plan
1. Na već postojećem nalogu otvori prijavu → **Zaboravljeno korisničko ime**, unesi registrovanu e-poštu i proveri da mail sadrži tačan @username.
2. Unesi neku drugu e-poštu: odgovor treba da bude generički, ne sme otkriti postoji li nalog.
3. Otvori **Zaboravljena lozinka**, zatraži kod, unesi ga i dve jednake nove lozinke. Proveri da stara lozinka više ne radi.
4. Testiraj pogrešan kod, ponovno korišćenje koda i različite nove lozinke: reset mora biti odbijen.
5. Testiraj SFF kada je Resend nedostupan: SFF mora pokazati razumljivu poruku o nedostupnom servisu, a ne lažno garantovati slanje.
6. Proveri Android i Windows WebView, jer CI testira API i kod, ali ne može potvrditi isporuku na stvaran Resend nalog bez produkcionih pristupnih podataka.

Ovo nije **brisanje naloga**, već bezbedni oporavak zaboravljene lozinke i korisničkog imena. Ako osoba više nema pristup registrovanoj e-pošti, automatski oporavak zasad nije podržan.
