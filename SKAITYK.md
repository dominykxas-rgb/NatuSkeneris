# Penklinė

Natų nuotraukas ir PDF paverčia MusicXML failais, kuriuos atsidaro MuseScore, Sibelius,
Finale, Dorico ir kitos natų programos.

## Svetainė (kompiuteris ir telefonas)

https://dominykxas-rgb.github.io/NatuSkeneris/

Atpažinimas vyksta pačioje naršyklėje, nuotraukos niekur nesiunčiamos. Pirmą kartą atsisiunčiama
apie 190 MB (atpažinimo modeliai ir Python), vėliau viskas paimama iš naršyklės atminties.
Veikia naujausiose Chrome, Edge ir Samsung Internet versijose. Telefone naršyklės meniu
pasirink „Įdiegti programą“ arba „Pridėti prie pagrindinio ekrano“.

## Windows programa

Atsisiųsk `Penkline-Windows.zip` iš [naujausios versijos](https://github.com/dominykxas-rgb/NatuSkeneris/releases/tag/naujausia),
išarchyvuok ir paleisk `Penkline.exe`.

Jei Windows parodys „Windows protected your PC“, spausk **More info → Run anyway**.

## Naudojimas

1. Įmesk nuotraukas ar PDF. Keli lapai sujungiami į vieną kūrinį ta tvarka, kuria sudėti.
2. Spausk **Atpažinti**.
3. **Atidaryti** atidaro natas programa, kuri kompiuteryje nustatyta MusicXML failams.

Rezultatai saugomi aplanke `Dokumentai\Penklinė`.

Geriausiai atpažįstamos spausdintos natos, nufotografuotos tiesiai iš viršaus.

## Diegimas iš kodo

Paleisk `Idiegti.bat`. Jis įdiegs Python, reikalingus paketus, atpažinimo modelius ir sukurs
nuorodą darbalaukyje.

## Licencijos

| Dalis | Projektas | Licencija |
|---|---|---|
| Natų atpažinimas | [homr](https://github.com/liebharc/homr) | AGPL-3.0 |
| Natų peržiūra | [Verovio](https://www.verovio.org) | LGPL-3.0 |
| Nuotraukų apdorojimas | OpenCV, Pillow | Apache-2.0, HPND |
| Grojimas | html-midi-player | Apache-2.0 |

Penklinė platinama pagal AGPL-3.0 licenciją.
