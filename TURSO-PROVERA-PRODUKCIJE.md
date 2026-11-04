# Provera Turso produkcije

SFF sada mora da koristi trajnu Turso bazu pre objavljivanja zaštite.

Automatizovana provera čita isključivo javni `/health` endpoint. Prolazni rezultat je `{"ok":true,"database":"turso"}`. Ako je `database` drugačiji, nikada ne objavljuj zaštitni kod kao završen.

Posle provere potrebno je proveriti da testni nalog i objava prežive restart Render instance. Privatne tokene ne unositi u GitHub ni u dokumentaciju.
