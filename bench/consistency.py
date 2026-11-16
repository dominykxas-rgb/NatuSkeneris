"""Atpažinimo rezultato vidinis nuoseklumas be teisingo atsakymo.

Kiekviename takte kiekvieno balso natų ir pauzių trukmių suma turi sutapti su metru.
Kuo daugiau taktų sutampa, tuo labiau tikėtina, kad atpažinta teisingai. Naudojama
renkantis geriausią iš kelių bandymų.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET


def _num(el, tag, default=0.0):
    c = el.find(tag) if el is not None else None
    try:
        return float(c.text) if c is not None and c.text else default
    except ValueError:
        return default


def analyze(xml_text: str) -> dict:
    try:
        root = ET.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)
    except ET.ParseError:
        return {"measures": 0, "good": 0, "notes": 0, "score": 0.0}
    measures = good = notes = 0
    for part in root.iter("part"):
        div, beats, beat_type = 1.0, 4.0, 4.0
        mlist = part.findall("measure")
        for i, m in enumerate(mlist):
            for attr in m.findall("attributes"):
                if attr.find("divisions") is not None:
                    div = _num(attr, "divisions", div)
                t = attr.find("time")
                if t is not None and t.find("beats") is not None:
                    try:
                        beats = float(t.find("beats").text.split("+")[0])
                    except ValueError:
                        pass
                    beat_type = _num(t, "beat-type", 4)
            expected = round(beats * 4 / beat_type * div)
            sums: dict[str, float] = {}
            for n in m.findall("note"):
                if n.find("grace") is not None or n.find("chord") is not None:
                    continue
                notes += 1
                key = (n.findtext("staff") or "1") + "|" + (n.findtext("voice") or "1")
                rest = n.find("rest")
                d = expected if rest is not None and rest.get("measure") == "yes" else _num(n, "duration")
                sums[key] = sums.get(key, 0) + d
            if not sums:
                continue
            measures += 1
            first, last = i == 0, i == len(mlist) - 1
            ok = all(round(s) == expected or (round(s) < expected and (first or last)) for s in sums.values())
            good += ok
    score = good / measures if measures else 0.0
    return {"measures": measures, "good": good, "notes": notes, "score": score}
