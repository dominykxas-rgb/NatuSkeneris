"""Penklinės tikslumo matavimas: vieno varianto paleidimas.

Paima sheet-music-photos rinkinio pavyzdžius (švarius skenavimus su patikrintu atsakymu ir
visas telefono nuotraukas), paruošia paveikslėlius pagal variantą, paleidžia homr ir
išsaugo rezultatus. Vertinimą atlieka score.py.

python bench/run_variant.py --homr work/homr-new --data work/smp --variant prep --out out/new-prep
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))
sys.path.insert(0, str(ROOT / "bench"))

from photo_prep import prepare_image  # noqa: E402
from variants import VARIANTS  # noqa: E402


def samples(data: Path) -> list[dict]:
    out = []
    for scan in sorted(p for p in (data / "scans").iterdir() if p.is_dir()):
        verified = scan / "page.musicxml"
        reference = scan / "reference.musicxml"
        gt = verified if verified.exists() else reference if reference.exists() else None
        if gt is None:
            continue
        kind = "verified" if gt == verified else "reference"
        if kind == "verified":
            out.append({"id": f"{scan.name}__scan", "source": str(scan / "page.pdf"), "type": "scan",
                        "gt": str(gt), "gt_kind": kind})
        pj = scan / "photos" / "photos.json"
        if pj.exists():
            for photo in json.loads(pj.read_text(encoding="utf-8"))["photos"]:
                out.append({"id": f"{scan.name}__{Path(photo['file']).stem}",
                            "source": str(scan / "photos" / photo["file"]), "type": "photo",
                            "gt": str(gt), "gt_kind": kind,
                            "conditions": photo.get("conditions", [])})
    return out


def load_source(path: str) -> np.ndarray:
    if path.endswith(".pdf"):
        import pypdfium2 as pdfium

        doc = pdfium.PdfDocument(path)
        img = np.array(doc[0].render(scale=200 / 72, grayscale=True).to_pil().convert("RGB"))
        doc.close()
        return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    from PIL import Image, ImageOps

    pil = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    return cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--homr", type=Path, help="homr checkout (variklis homr)")
    ap.add_argument("--engine", choices=["homr", "copisteria"], default="homr")
    ap.add_argument("--copisteria", type=Path, help="copisteria checkout su models/")
    ap.add_argument("--detector", default="28m", help="copisteria detektorius: 28m arba 2m")
    ap.add_argument("--data", required=True, type=Path)
    ap.add_argument("--variant", required=True, choices=list(VARIANTS))
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()

    out: Path = args.out
    img_dir = out / "img"
    shutil.rmtree(out, ignore_errors=True)
    img_dir.mkdir(parents=True)

    items = samples(args.data)
    if args.limit:
        items = items[: args.limit]
    for s in items:
        image = load_source(s["source"])
        tmp = img_dir / f"_src_{s['id']}.png"
        cv2.imwrite(str(tmp), image)
        result = VARIANTS[args.variant](tmp, img_dir / f"{s['id']}.png", prepare_image)
        tmp.unlink()
        s["note"] = result or ""

    t0 = time.time()
    if args.engine == "homr":
        env = dict(os.environ, PYTHONPATH=str(args.homr.resolve()))
        proc = subprocess.run([sys.executable, "-m", "homr.main", str(img_dir.resolve()), "--no-title"],
                              cwd=str(args.homr), env=env, capture_output=True, text=True)
    else:
        pages = [str((img_dir / f"{s['id']}.png").resolve()) for s in items]
        res_dir = (out / "copisteria").resolve()
        proc = subprocess.run([sys.executable, "-m", "copisteria.pipeline", *pages, "--out", str(res_dir),
                               "--detector", args.detector],
                              cwd=str(args.copisteria), capture_output=True, text=True)
        for x in res_dir.glob("*.musicxml"):
            shutil.copy(x, img_dir / x.name)
    (out / "engine.log").write_text(proc.stdout + proc.stderr, encoding="utf-8")
    seconds = time.time() - t0

    done = 0
    for s in items:
        xml = img_dir / f"{s['id']}.musicxml"
        s["ok"] = xml.exists()
        if xml.exists():
            shutil.copy(xml, out / f"{s['id']}.musicxml")
            done += 1
    (out / "samples.json").write_text(json.dumps({"variant": args.variant, "engine": args.engine,
                                                  "seconds": seconds, "samples": items}, indent=1),
                                      encoding="utf-8")
    print(f"{args.variant}: {done}/{len(items)} atpažinta per {seconds:.0f} s")


if __name__ == "__main__":
    main()
