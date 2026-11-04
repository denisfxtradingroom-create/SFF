# SFF 0.8.1 — Online vizuelno osveženje

## Šta je stvarno promenjeno
- Dodata **ambijentalna pozadina nakon prijave**, izvedena iz postojeće crveno-tamne palete stranice za prijavu: statički gradienti, blagi geometrijski detalji i gotovo neprimetan natpis **SFF** iza razgovora.
- **Početna** sada koristi isti vizuelni jezik, uz diskretno osvetljenje u uglovima, jasnije granice objava i nežnije kontraste.
- Lagano usklađeni paneli za spisak razgovora, kontakte, zajednice, kompozitor poruka, profile i iskačuće dijaloge. Sačuvani su postojeći GUI elementi i njihova logika.
- **Početna** je na prvom mestu u postojećem donjem mobilnom meniju. Sva ostala dugmad i akcije ostaju na svojim mestima.
- Ugrađeno u **web resurse** servera; već instalirani Android/Windows klijenti automatski dobijaju izmene nakon ponovnog otvaranja aplikacije.

## Tehnički pristup
- Novi `client/ambient-theme.css` učitan **posle** postojećih CSS datoteka, tako da je promena izolovana i lako reverzibilna.
- Nema novih fontova, eksternih slika, video-pozadina, network zahteva, animiranih shader efekata niti promene veličine osnovnih GUI kolona.
- Za vizuelni SFF znak koristi se čisti CSS tekst, bez velikog prikaza maskote.
- Stari `client/mark.svg` ostaje netaknut za navigaciju i postojeće identitetske elemente.

## Važno: raniji reset naloga
Ovaj update **ne ponavlja brisanje** i ne sadrži SQL operacije nad korisnicima. Ako je zasebno u Turso nalogu već izvršen reset svih SFF naloga, taj reset ostaje, a korisnici koji su se prijavili nakon reseta nisu obrisani. Nije moguće potvrditi broj naloga iz vizuelnog CI testa.

## Testiranje
`node tests/ambient-theme.mjs`: proverava učitavanje CSS-a, vezu sa ekranom Početna, prisustvo mobilne prilagodbe i da je novi brendirani sloj dekorativan. Postojeći backend, chat, mediji, autentifikacija i društvena Početna prolaze kroz postojeći `SFF CI`.

## Ručna provera
Posle Render deploy-a otvoriti SFF na Androidu i Windows-u. Zatvoriti/otvoriti aplikaciju i proveriti prijavu, Početnu, razgovore, prikaz tastature, donji meni, glasovne poruke i profil.
