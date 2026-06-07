# MVP

## Ekrany

### Home

- Sylwetka z kolorami tygodniowej objetosci:
  - zielony: ponizej optimum,
  - zolty: w zakresie optymalnym,
  - czerwony: za wysoko albo na limicie.
- Lista tygodniowych serii dla Chest, Back, Legs, Shoulders, Arms, Core.
- Lista template'ow.
- Start treningu z template'u.
- Tworzenie i edycja template'u.

### Start Workout

- Manualny trening bez template'u.
- Dodawanie cwiczen z katalogu.
- Serie z polami weight i reps.
- Oznaczanie serii jako wykonanej.
- Timer przerwy: edytowalna wartosc inline, presety 60/90/120/180s, korekta -15/+15s, wibracja po dojsciu do 0.
- Zapis treningu do historii.

### Exercise Catalog

- Kategorie: Chest, Back, Legs, Shoulders, Arms, Core.
- Basicowe cwiczenia sortowane alfabetycznie.
- Custom exercises na dole kategorii.
- Formularz dodawania custom exercise.

### History

- Calendar:
  - miesieczny widok,
  - oznaczenie dni treningowych,
  - podglad sesji z dnia,
  - szczegoly treningu.
- Monthly Progress:
  - wybor miesiaca,
  - wybor cwiczenia,
  - wykres estimated 1RM,
  - Best Weight, Best Set, Estimated 1RM, Monthly Volume, Sessions,
  - porownanie z poprzednim miesiacem: Δ Best Weight, Δ 1RM, Δ Volume.

### Profile

- Imie.
- Cel treningowy.
- Masa ciala.
- Edytowalne zakresy tygodniowych serii.
- Eksport danych JSON.

## Dane

Na tym etapie dane sa lokalne:

```text
localStorage key: silownia-local-v1
```

Kolejny etap techniczny:

```text
backend + SQLite + prywatny serwer domowy
```
