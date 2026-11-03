# SFF 0.7 — Početna / Lični zid (online update)

## Šta je novo
- U donjem meniju na Androidu i u bočnom meniju na Windowsu „Novosti“ se zovu **Početna**.
- Početna prikazuje najnovije objave korisnika i njegovih **potvrđenih prijatelja**.
- Iz profila korisnika: **Moj zid** / **Pogledaj zid**.
- Objave: tekst do 2.500 karaktera, JPG/PNG do 1 MB (jedna fotografija), brisanje svojih objava.
- Sviđanja: uključivanje/isključivanje jednog lajka po korisniku.
- Komentari: do 600 karaktera, autor može obrisati svoj komentar, autor objave može obrisati komentar na svojoj objavi.
- Deljenje objava u privatni chat samo potvrđenim prijateljima; primaoc mora imati pravo pristupa izvornoj objavi.
- Link u privatnoj poruci otvara konkretnu objavu preko #objava=ID.
- Automatsko osvežavanje vidljivog zida kada prijatelj objavi nešto novo.
- Srpski nazivi za osnovne stavke menija, uloge i statuse; vrednosti statusa koje server očekuje ostale su iste.
- Centar obaveštenja ostaje dostupan preko 🔔 u Početnoj.

## Bezbednost
Sve autorizacije su serverske: nepoznat korisnik ne može da vidi ni post, ni komentare, ni fotografiju. Blokirani korisnici ne mogu pristupati međusobnim zidovima. Uklanjanje prijateljstva automatski ukida pristup tuđim objavama, čak i preko starih linkova.

## Isporuka
Novo je isključivo web + server; postojeći Android APK i Windows klijent automatski učitavaju update nakon zatvaranja/ponovnog otvaranja SFF. Nema nove instalacije.

## Ograničenja
- Lokalni SQLite na Render Free nije trajna produkciona baza. Ako nema podešenog Turso-a, nalozi, objave i poruke mogu nestati pri restartu/redeployu.
- Interfejs radi na srpskom, ali sistemske Android poruke/dozvole i interni API stringovi zavise od platforme.
- Fotografije u objavama ograničene su na 1 MB; u budućnosti dodati automatsko smanjivanje veličine.
- Sadržaj zida je privatnost *među prihvaćenim prijateljima*, nije javni feed svih korisnika.
- Backend je pokriven automatizovanim testovima, ali interakciju na konkretnim Android/Windows uređajima treba praktično proveriti.
