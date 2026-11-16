"""Penklinės tikslumo matavimas: rezultatų įvertinimas ir palyginimas.

Naudoja homr autoriaus OMR-NED (normalizuotas redagavimo atstumas tarp teisingų ir
atpažintų natų bei pauzių; 0 % = tobulai). Mažiau yra geriau.

python bench/score.py --scorer work/homr-new out/new-raw out/new-prep ...
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from consistency import analyze  # noqa: E402

GROUPS = {
    "skenai (patikrinti)": lambda s: s["type"] == "scan" and s["gt_kind"] == "verified",
    "nuotraukos (patikrintos)": lambda s: s["type"] == "photo" and s["gt_kind"] == "verified",
    "nuotraukos (vs švarus lapas)": lambda s: s["type"] == "photo" and s["gt_kind"] == "reference",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scorer", required=True, type=Path, help="homr checkout su validation/")
    ap.add_argument("--json", type=Path, default=Path("bench-results.json"))
    ap.add_argument("--title", default="Tikslumas (OMR-NED, mažiau = geriau)")
    ap.add_argument("runs", nargs="+", type=Path)
    args = ap.parse_args()
    sys.path.insert(0, str(args.scorer.resolve()))
    try:
        import torch  # noqa: F401, PLC0415
    except ImportError:  # vertinimui torch nereikia, tik jo importo
        import types  # noqa: PLC0415

        fake = types.ModuleType("torch")
        fake.Tensor = object
        sys.modules["torch"] = fake
    from validation.ned_score import _ned_from_parts, _parse_output  # noqa: PLC0415

    def ned(gt: str, out: str) -> dict:
        try:
            g, p = _parse_output(gt, out, notes_and_rests_only=True)
            r = _ned_from_parts(g, p)
            return {"ned": r.ned, "pitch": r.pitch_ned, "rhythm": r.rhythm_ned, "lift": r.lift_ned}
        except Exception as e:  # noqa: BLE001
            return {"ned": 1.0, "pitch": 1.0, "rhythm": 1.0, "lift": 1.0, "error": str(e)[:200]}

    runs = {}
    for run in args.runs:
        meta = json.loads((run / "samples.json").read_text(encoding="utf-8"))
        name = run.name
        per = {}
        for s in meta["samples"]:
            gt = Path(s["gt"]).read_text(encoding="utf-8")
            xml_path = run / f"{s['id']}.musicxml"
            out = xml_path.read_text(encoding="utf-8") if xml_path.exists() else ""
            r = ned(gt, out) if out else {"ned": 1.0, "pitch": 1.0, "rhythm": 1.0, "lift": 1.0, "error": "nėra rezultato"}
            r["consistency"] = analyze(out)["score"] if out else 0.0
            per[s["id"]] = {**s, **r}
        runs[name] = {"seconds": meta["seconds"], "per": per}

    ids = list(next(iter(runs.values()))["per"].keys())

    # Geriausias iš kelių bandymų pagal nuoseklumą (be teisingo atsakymo) ir „orakulas“ (viršutinė riba)
    def pick(names: list[str], key) -> dict:
        per = {}
        for i in ids:
            best = max(names, key=lambda n: key(runs[n]["per"][i]))
            per[i] = {**runs[best]["per"][i], "picked": best}
        return per

    names = list(runs)
    if len(names) > 1:
        runs["→ geriausias pagal nuoseklumą"] = {"seconds": sum(r["seconds"] for r in runs.values()),
                                                 "per": pick(names, lambda r: r["consistency"])}
        runs["→ orakulas (riba)"] = {"seconds": 0, "per": pick(names, lambda r: -r["ned"])}

    lines = []
    header = "variantas | " + " | ".join(GROUPS) + " | aukštis | ritmas | laikas"
    lines.append(header)
    table = {}
    for name, run in runs.items():
        cells = []
        for g, f in GROUPS.items():
            vals = [r["ned"] for r in run["per"].values() if f(r)]
            cells.append(f"{100 * statistics.mean(vals):.1f}% (n={len(vals)})" if vals else "-")
        allv = list(run["per"].values())
        pitch = 100 * statistics.mean(r["pitch"] for r in allv)
        rhythm = 100 * statistics.mean(r["rhythm"] for r in allv)
        lines.append(f"{name} | " + " | ".join(cells) + f" | {pitch:.1f}% | {rhythm:.1f}% | {run['seconds']:.0f}s")
        table[name] = {"cells": cells, "pitch": pitch, "rhythm": rhythm, "per": run["per"]}

    # Ar nuoseklumas atspindi tikslumą?
    pairs = [(r["consistency"], r["ned"]) for n in names for r in runs[n]["per"].values()]
    if len(pairs) > 3:
        xs, ys = zip(*pairs)
        try:
            corr = statistics.correlation(xs, ys)
            lines.append(f"nuoseklumo ir klaidų koreliacija: {corr:.2f} (neigiama = gerai)")
        except statistics.StatisticsError:
            pass

    text = "\n".join(lines)
    print(text)
    print(f"::notice title={args.title}::" + text.replace("\n", "%0A"))
    args.json.write_text(json.dumps(table, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
