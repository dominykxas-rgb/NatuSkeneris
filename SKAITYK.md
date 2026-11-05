# Natų skeneris

Nemokama atviro kodo programėlė Windows kompiuteriui. Natų nuotraukas (ir telefonu darytas) bei PDF
paverčia elektroninėmis natomis, kurias gali taisyti MuseScore.

## Paprasčiausias būdas: paruoštas exe

1. GitHub saugyklos skiltyje **Releases → naujausia** atsisiųsk `NatuSkeneris-Windows.zip`.
2. Išarchyvuok ir paleisk **NatuSkeneris.exe**. Nieko diegti nereikia.
3. Jei Windows parodys „Windows protected your PC“, spausk **More info → Run anyway**
   (exe nėra pasirašytas mokamu sertifikatu).

## Diegimas iš kodo (vieną kartą)

1. Išarchyvuok šį aplanką ten, kur jis liks, pvz. `Dokumentai\NatuSkeneris`.
2. Dukart spustelėk **Idiegti.bat**. Programa:
   - suras arba įdiegs Python 3.12;
   - įdiegs reikalingus paketus ir atpažinimo variklį homr;
   - atsisiųs atpažinimo modelius (reikia interneto, kelios minutės);
   - sukurs nuorodą **Natų skeneris** darbalaukyje.
3. Įsidiek nemokamą **MuseScore 4**: https://musescore.org/download
   Be jo programėlė veiks, bet išsaugos tik MusicXML failą.

## Naudojimas

1. Paleisk **Natų skeneris** iš darbalaukio (arba `Paleisti.bat`).
2. Įmesk nuotraukas ar PDF. Keli puslapiai sujungiami į vieną kūrinį pagal eilę (rodyklėmis gali keisti tvarką).
3. Spausk **Atpažinti natas**. Vienas puslapis kompiuteryje atpažįstamas maždaug per minutę ar dvi.
4. Patikrink peržiūrą ir spausk **Atidaryti ir taisyti MuseScore**.

Rezultatai (`.musicxml` ir `.mscz`) automatiškai išsaugomi aplanke `Dokumentai\NatuSkeneris`.

## Patarimai geresniam atpažinimui

- Fotografuok tiesiai iš viršaus, lapas turi būti visas kadre, gerai apšviestas, be šešėlių.
- Geriausiai atpažįstamos spausdintos natos. Ranka rašytas natas atpažįsta prastai.
- Atpažinimas nebūna 100 % tikslus: visada peržiūrėk rezultatą MuseScore.

## Iš ko sudaryta

| Dalis | Projektas | Licencija |
|---|---|---|
| Natų atpažinimas | [homr](https://github.com/liebharc/homr) | AGPL-3.0 |
| Natų peržiūra | [Verovio](https://www.verovio.org) | LGPL-3.0 |
| Nuotraukų apdorojimas | OpenCV, Pillow | Apache-2.0, HPND |
| Taisymas, .mscz | [MuseScore](https://musescore.org) (diegiamas atskirai) | GPL-3.0 |
| Grojimas peržiūroje | html-midi-player | Apache-2.0 |

Kadangi naudojamas homr (AGPL-3.0), ši programėlė taip pat platinama pagal **AGPL-3.0** licenciją.

## Jei kas nors neveikia

- Programėlė neatsidaro: paleisk `Paleisti.bat`; jei rašo, kad neįdiegta, paleisk `Idiegti.bat`.
- MuseScore įdiegtas, bet nerandamas: programėlės lange įrašyk kelią iki `MuseScore4.exe`.
- Atpažinimas nepavyksta: lange išskleisk „Išsami informacija“ ir nusiųsk tą tekstą.
