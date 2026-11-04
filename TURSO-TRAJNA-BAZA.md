# SFF — trajna Turso baza (bez novog APK/EXE)

## Stanje
SFF Render Free backend trenutno koristi lokalni SQLite. To NIJE trajno: nove instance/restarti gube naloge, poruke, prijatelje, fotografije i objave. Ovo se rešava spajanjem postojeće backend podrške za udaljeni Turso libSQL.

## Jednokratna aktivacija (radi vlasnik Turso naloga)
1. Otvori https://app.turso.tech/ i prijavi se / napravi besplatan Turso Cloud nalog.
2. Kreiraj bazu npr. `sff-production`, tip **libSQL** (postojeći SFF koristi kompatibilni libSQL API). Izaberi evropsku grupu/lokaciju blizu Frankfurt Render servera, ako se nudi.
3. U Turso panelu baze pronađi **Connect / Database URL** i kreiraj **auth token sa pravima čitanja i pisanja** za tu bazu. Sačuvaj ih privatno.
4. U Render otvori svoj servis `sff-signal-api` > **Environment**, pa unesi ove tri vrednosti **zajedno**:
   - `TURSO_DATABASE_URL` = stvarna adresa baze (`libsql://...`)
   - `TURSO_AUTH_TOKEN` = privatni token
   - `SFF_REQUIRE_DURABLE_DB` = `1`
5. Save, deploy. NIKADA ne postavljaj tokene u javni GitHub, APK, chat ili screenshot. Ako token iscuri, opozovi ga i izdaj novi.
6. Kada je backend `live`, otvori https://sff-signal-api.onrender.com/health i proveri `{"ok":true,"database":"turso"}`. Ako piše `local`, još nije aktivirano. Ako je deploy failed, proveri Render log bez kopiranja privatnih podataka.
7. Registruj jedan TEST nalog, pošalji poruku, objavi status. Nakon kontrolisanog restarta proveri isti nalog i sadržaj. Turso treba da bude dostupan i pri sledećem restartu.
8. Po mogućnosti proveri cloud zapis pomoću `node scripts/verify-turso.mjs` u bezbednom runtime-u sa Turso env var. Skripta testira zapis kroz dve nezavisne veze, briše samo svoj test zapis i ne prikazuje token.

## Šta SFF radi u kodu
- Ako su obe tajne postavljene, backend odmah bira Turso umesto lokalnog SQLite.
- Ako je samo jedna tajna postavljena, backend prijavljuje grešku, **ne prelazi na lokalni SQLite**.
- Ako je `SFF_REQUIRE_DURABLE_DB=1` bez Turso URL/tokena, backend odbija pokretanje, radi zaštite podataka.
- Ne menja se Android/Windows aplikacija; API adresa ostaje ista.
- **Ne može se automatski vratiti već obrisana SQLite baza.** Ovaj postupak štiti buduće naloge i poruke. Postojeće lokalne podatke treba zasebno izvesti ako su još dostupni, pre promene Render okruženja.
- Za velike količine fotografija i snimaka kasnije izdvojiti datoteke u objektno skladište; trenutno baza sadrži i binarne priloge.

## Zašto ne Render Free Postgres?
On ističe posle 30 dana; Render Free Key Value nije trajan. Za trenutni SQLite SFF kod Turso libSQL je manja i sigurnija izmena od kompletnog prelaska na PostgreSQL.

## CI
`node tests/database-guard.mjs` proverava odbijanje neispravnih postavki i kompatibilni database adapter. `node scripts/verify-turso.mjs` radi stvarnu cloud proveru samo kada su credentials već bezbedno dostupni. Testovi bez stvarne Turso baze NE dokazuju da cloud konfiguracija radi.

## Napomena o besplatnom hostingu
Render Free se i dalje uspavljuje, pa prvi zahtev može kasniti; ovo ne briše korisničke podatke ako je baza na Turso. Na besplatnoj Turso bazi mogu važiti kvote i ograničenja; prati njihovo korišćenje.
