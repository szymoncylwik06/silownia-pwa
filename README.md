# Silownia

Prywatna lokalna aplikacja web/PWA do zapisywania treningow i progresu na silowni.

## Zasady projektu

- Praca lokalnie w `D:\silownia`.
- Brak zdalnych repozytoriow.
- Brak chmury, analityki i zewnetrznego logowania w MVP.
- Dane MVP sa zapisane w `localStorage` przegladarki.
- Domyslny interfejs jest mobile-first pod iPhone.
- Domyslny motyw: ciemny (czern + szarosc, bialy tekst).

## Uruchomienie lokalne

Najprostszy launcher (dwuklik):

```text
Silownia.cmd
```

Otwiera przegladarke i startuje `python -m http.server` na porcie 4217. Zamkniecie okna konsoli wylacza serwer.

Alternatywnie PowerShell:

```powershell
.\start-local.ps1
```

Adres:

```text
http://127.0.0.1:4217/
```

Port projektu:

```text
4217
```

Test na iPhonie w tej samej sieci LAN:

```powershell
.\start-local.ps1 -Lan
```

Wtedy wejscie z iPhone'a:

```text
http://ADRES-IP-KOMPUTERA:4217/
```

## Aktualny zakres MVP

- Home z sylwetka i tygodniowa objetoscia partii miesniowych.
- Template'y na ekranie Home.
- Start Workout jako manualny trening bez template'u.
- Katalog cwiczen z kategoriami Chest, Back, Legs, Shoulders, Arms, Core.
- Default exercises sortowane A-Z.
- Custom exercises na dole kategorii.
- Zapisywanie serii, ciezaru, powtorzen i przerw.
- Timer przerwy z presetami 60/90/120/180s, korekta -15/+15s, edytowalna wartosc inline, wibracja po zakonczeniu.
- Edycja template z polami Sets / Reps min / Reps max / Rest sec.
- History z kalendarzem.
- Monthly Progress z wykresem i statystykami cwiczenia + porownania mies. (Δ Best Weight / Δ 1RM / Δ Volume).
- Profile z podstawowymi danymi i zakresami tygodniowych serii.

## Service worker / cache

Strategia `network-first` z fallbackiem do cache (`sw.js`). Bumpuj `CACHE_NAME` przy istotnych zmianach assetow, zeby wymusic przejscie nowego SW na klientach (uzywa `skipWaiting` + `clients.claim`).
