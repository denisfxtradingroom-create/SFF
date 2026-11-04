# SFF 0.8.6 — društvena obaveštenja i privatni razgovori

## Zvonce / Obaveštenja
- U društvena obaveštenja ulaze **zahtevi i prihvatanja prijateljstva, lajkovi i komentari na moje objave, kao i nove objave mojih prijatelja**.
- Privatne poruke **nikada ne idu u društveno zvonce**, a njihov tekst se ne prikazuje kao društveno obaveštenje. Stari privatni pregledi se uklanjaju iz lokalne istorije zvonceta.
- Nepročitane privatne poruke ostaju u Razgovorima preko postojećeg crvenog brojača.
- Društvene aktivnosti stižu preko već postojećeg WebSocket-a, bez periodičnog čitanja Turso baze.

## Privatni chat
- Moje poruke se prikazuju desno, tuđe levo, sa različitim bojama balončića. Kanali i grupni razgovori ostaju kao ranije.
- Osvežavanje podataka više ne briše kompletan chat, kompozitor i skrol. Neizmenjeni elementi poruka se zadržavaju.
- Poslednja moja poruka prikazuje „✓ Poslato“ dok drugi korisnik ne otvori chat i ne pošalje potvrdu čitanja, a zatim „✓✓ Viđeno“.
- Status čitanja dobija se iz postojećih `reads` zapisa i istog indeksiranog upita za sobe (bez dodatnog Turso request-a za listu).

## Audio i video pozivi
- Dugmad **Poziv** i **Video** u privatnom razgovoru.
- Dolazni poziv: ekran sa Javi se/Odbij; izlazni poziv: čekanje/prekid.
- Mediji se prenose preko postojećeg WebRTC-a. Server proverava da su učesnici dva legitimna člana privatnog razgovora; nije otvoren javni poziv.
- Ako nema aktivnog WebSocket-a primaoca, pozivaocu se prikazuje da korisnik nije dostupan. Nema lažnog zvonjenja.
- **Ograničenje koje još važi:** ako je Android aplikacija potpuno ugašena ili sistem suspenduje njen proces, poziv **ne može pouzdano da zazvoni bez sistemskog push mehanizma** (npr. Firebase Cloud Messaging + odgovarajuća podrška u Android APK-u). I u Windows aplikaciji mora postojati aktivna konekcija. To je odvojena funkcionalnost; nije predstavljeno kao završeno.
- Za povezivanje između restriktivnih mreža/natova može biti potreban TURN server. SFF koristi postojeće `SFF_ICE` podešavanje za ICE/STUN/TURN, bez promene konfiguracije.

## Kompatibilnost i bezbednost
- UI se isporučuje sa istog Render servera u browseru, Windows WebView2 i Android WebView aplikaciji.
- Nema reseta naloga, nema izmena lozinki, baza i pravilnik 7-dnevnog brisanja ostaju netaknuti.
- CI pokriva podešavanja notifikacija, društvene događaje i privatnost, bezbedno signaliziranje poziva, prikaz „Viđeno“ i prethodne testove.
