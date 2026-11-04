# SFF 0.8.5 — sedmodnevno čišćenje i manje Turso upita

## Pravila čuvanja
- Tekstualne poruke, korisnički nalozi, korisnička imena, mejlovi, lozinke i prijave: **ne brišu se** ovim update-om.
- Prilozi u porukama (fotografije, video, audio, glasovne poruke i drugi fajlovi): nakon 7 dana brišu se `bytes`, `mime` i `file`, ali **poruka i njen tekst ostaju**.
- Kada je poruka sadržala samo prilog, ostaje tekst „Prilog je uklonjen nakon 7 dana.“ radi očuvanja konteksta razgovora.
- Objave na Početnoj i korisničkom zidu: posle 7 dana brišu se kompletne objave, pripadajuće fotografije, komentari i lajkovi.
- Profilne slike, baneri i slike zajednica nisu vremenski ograničeni: to su trajne postavke profila, a ne prilozi u porukama/objavama.
- Poslate tekstualne veze ka objavama ostaju poruke, ali objava nakon isteka više ne može da se otvori.

## Kada se čisti
- Prilikom pokretanja servera i približno jednom na sat dok je server aktivan.
- Pristup preko `/media/*`, `/wall-media/*`, `wallOne`, `wallFeed` i čitanja istorije proverava rok: istekli mediji nisu dostupni čak ni pre narednog fizičkog čišćenja.
- Čišćenje radi u indeksiranim serijama od najviše 64 zapisa (16 serija po proveri). Kod velikog zaostatka više provera može biti potrebno dok se svi stari podaci ne uklone.
- SQLite/Turso može privremeno zadržavati oslobođene stranice u skladištu za ponovnu upotrebu; fizičko smanjenje veličine baze nije garantovano odmah.

## Smanjenje nepotrebnih upita
- Učitavanje strane sa do 50 poruka više ne pravi po dva upita po poruci za reakcije i odgovore: sve ide kroz **2 grupisana upita**.
- Pregled soba koristi grupisano čitanje poslednje aktivnosti, broja nepročitanih poruka, kategorija i statusa dostupnih korisnika; zadržane su pojedinačne provere prava pristupa.
- Notifikacije objedinjuju čitanje podešavanja primaoca; dozvole se proveravaju jednom po korisniku umesto za svaki povezani prozor.
- WebSocket obaveštenja zadržana su kao glavni način obaveštavanja. Uzastopne promene kratko se grupišu u klijentu.
- Identitet za notifikacije koristi već učitan podatak umesto ponovnog preuzimanja celog `/api/state` odgovora.
- Održavanje istečenih sesija: jedan pokušaj brisanja na 6 sati, umesto na svaki minut. Provera ovlašćenja za WebSocket ostaje na snazi.
- Dodati su SQL indeksi za starost medija, objava, sesije, učesnike i brojače poruka.

## Produkciona bezbednost
- **Nema reseta** korisničkih naloga ni promene Turso baze na privremeni SQLite.
- Ne dirati `SFF_ACCOUNT_RESET_ONCE`, ključeve ili lozinke.
- Za pregled bez sadržaja i korisničkih podataka, Render log: `[SFF retention] expired_attachments=N expired_posts=N`. Log se ispisuje samo kada se nešto obriše.
- Testovi: `npm test` (retention, retention-http, notification-transport, integration, read-state i ostali).

## Ograničenja
- Višestruki aktivni korisnici i česte promene soba i dalje opravdano generišu upite za dozvole; optimizacija ne znači da je broj SQL čitanja nula.
- Završna potrošnja zavisi od realnog korišćenja, pa je treba povremeno proveriti u Turso kontrolnoj tabli.
