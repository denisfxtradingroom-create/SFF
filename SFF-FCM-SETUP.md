# SFF — Android Firebase Cloud Messaging (FCM): priprema, nije aktivirano

## Status
- Ovo je **radna grana**. Produkcioni server i postojeća Windows/Android izdanja ostaju netaknuti dok se Firebase ne poveže i stvarni APK ne testira.
- Stari `android/build.ps1` je sačuvan; FCM izdanje koristi **novi** `android/push` Gradle modul jer je potreban zvanični Firebase Android SDK.
- Prijavljeni nalog vezuje FCM token sa serverom u `sff_push_devices`. Odjava opoziva povezivanje te sesije. Token se može preneti sa jednog SFF naloga na drugi uređaj samo nakon autentifikovane registracije u drugom nalogu.
- Server koristi Firebase Admin SDK v14 i **ne šalje push** bez zaštićene promenljive `SFF_FCM_SERVICE_ACCOUNT_JSON`.

## Jednokratno podešavanje Firebase projekta — bez kupovine domena
1. Na https://console.firebase.google.com/ kreirati besplatan **Spark** projekat (npr. `SFF`).
2. Dodati Android app sa **tačnim** package name `app.sff.signal`.
3. Preuzeti `google-services.json`; to je javna konfiguracija aplikacije (nije serverski privatni ključ). Prilikom builda ide u `android/push/app/google-services.json`, ali ga ne držati u Git repozitorijumu.
4. Firebase console → Project settings → Service accounts → Generate new private key. **Privatan JSON nikada ne ubacivati u GitHub ili u chat**. Sam vlasnik unosi njegov kompletan sadržaj u Render Environment kao `SFF_FCM_SERVICE_ACCOUNT_JSON` (samo server).
5. Za novu Android instalaciju potrebno je sačuvati **trajni release signing key** na bezbednom mestu. Prethodni SFF Android APK u GitHub CI je bio potpisan privremenim certifikatom, tako da nova verzija s drugačijim potpisom može zahtevati deinstalaciju stare (SFF server nalozi neće biti obrisani).

## Test Android APK-a
`android/push` je novi Gradle projekat sa standardnim Firebase Messaging SDK-om. Koristi originalni `android/Main.java` i postojeće resurse, bez dupliciranja osnovnog WebView koda. Potrebni su Java 17, Android SDK 36, Gradle 8.13 i konfiguracija `google-services.json`. Primer build komande: `gradle -p android/push :app:assembleDebug`.

## Korisnički tok
- Korisnik otvori SFF, prijavi se i dozvoli obaveštenja.
- Android pribavlja FCM token i predaje ga putem SFF HTTPS session API-ja `pushRegister`. Windows i web klijenti nastavljaju da rade kao pre.
- Kada neko pozove korisnika bez aktivnog WebSocket-a, server šalje visoko-prioritetno dolazno obaveštenje sa kratkim rokom važenja (45 s).
- Dodir obaveštenja otvara SFF; čim se autentifikovani WebSocket poveže, poziv se prikazuje ako još traje, sa dugmadima za odgovor/odbijanje.
- Ovo nije garancija poziva nakon **Force stop** u Android Settings. Android/Google servis može odložiti ili odbiti dostavu zbog doze režima, baterije, uskraćene dozvole ili nepostojanja Google Play services. Proveriti na stvarnom uređaju.
- Standardno slanje FCM je **besplatno**, ali ostali Cloud servisi u Firebase/Google Cloud mogu imati posebne troškove.

## Bezbednost i troškovi
- FCM token se nikada ne izlaže kroz društvene objave niti korisničke poruke. Registracija zahteva validnu SFF sesiju, a odjava briše token tog session ID-ja.
- Nema redovnog Turso polling-a, a push slanje se pokreće samo na konkretan poziv.
- Ne pokretati produkcioni deploy bez Firebase projekta, validnog testnog APK-a i provere rada poziva preko dve mreže.
