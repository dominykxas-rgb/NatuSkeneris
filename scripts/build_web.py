"""Surenka Penklinės svetainę į vieną aplanką (GitHub Pages).

Naudojimas (GitHub Actions):
    python scripts/build_web.py --engine engine/homr --node node_modules --out _site

Reikia, kad engine/homr būtų atsiųstas ir modeliai parsisiųsti (run_homr.py --init),
o node_modules turėtų pyodide, onnxruntime-web, pdfjs-dist ir verovio.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY_PACKAGES = ["numpy", "opencv-python", "pillow", "lzma", "typing-extensions"]


def die(msg: str) -> None:
    print("KLAIDA:", msg)
    sys.exit(1)


def copy(src: Path, dst: Path) -> None:
    if not src.exists():
        die(f"nerastas {src}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def build_homr_zip(engine: Path, out: Path) -> None:
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(engine.rglob("*")):
            if p.is_file() and p.suffix in (".py", ".json") and "__pycache__" not in p.parts:
                z.write(p, Path("homr") / p.relative_to(engine))
        for p in sorted((ROOT / "web" / "py").glob("*.py")):
            z.write(p, p.name)
        z.write(ROOT / "app" / "photo_prep.py", "photo_prep.py")
        import typing_extensions  # vienas failas, homr jo reikia
        z.write(typing_extensions.__file__, "typing_extensions.py")


def find_models(engine: Path) -> list[Path]:
    picks = []
    for pattern in ("segmentation/segnet_*.onnx", "transformer/encoder_*.onnx",
                    "transformer/decoder_*.onnx"):
        found = [p for p in engine.glob(pattern) if not p.stem.endswith("_fp16")]
        if len(found) != 1:
            die(f"modelis {pattern}: rasta {len(found)} ({[p.name for p in found]})")
        picks.append(found[0])
    return picks


def vendor_pyodide(node: Path, out: Path) -> tuple[list[str], int]:
    src = node / "pyodide"
    version = json.loads((src / "package.json").read_text())["version"]
    dst = out / "vendor" / "pyodide"
    total = 0
    for name in ("pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip",
                 "pyodide-lock.json"):
        copy(src / name, dst / name)
        total += (dst / name).stat().st_size

    lock = json.loads((src / "pyodide-lock.json").read_text())
    packages = {k.lower(): v for k, v in lock["packages"].items()}
    wanted = [p for p in PY_PACKAGES if p in packages]
    missing = [p for p in ("numpy", "opencv-python", "pillow") if p not in packages]
    if missing:
        die(f"Pyodide {version} neturi paketų: {missing}")

    resolved: list[str] = []
    stack = list(wanted)
    while stack:
        name = stack.pop().lower()
        if name in resolved:
            continue
        resolved.append(name)
        stack.extend(packages[name].get("depends", []))

    base = f"https://cdn.jsdelivr.net/pyodide/v{version}/full/"
    for name in sorted(resolved):
        info = packages[name]
        target = dst / info["file_name"]
        print(f"  pyodide paketas {name} ({info['file_name']})")
        with urllib.request.urlopen(base + info["file_name"]) as r:
            data = r.read()
        digest = hashlib.sha256(data).hexdigest()
        if info.get("sha256") and digest != info["sha256"]:
            die(f"{name}: neteisinga kontrolinė suma")
        target.write_bytes(data)
        total += len(data)
    print(f"Pyodide {version}, paketai: {', '.join(sorted(resolved))}")
    return wanted, total


def vendor_ort(node: Path, out: Path) -> None:
    dist = node / "onnxruntime-web" / "dist"
    dst = out / "vendor" / "ort"
    bundle = next((dist / n for n in ("ort.wasm.min.mjs", "ort.min.mjs") if (dist / n).exists()), None)
    if bundle is None:
        die(f"onnxruntime-web: nerastas ort.wasm.min.mjs / ort.min.mjs ({sorted(os.listdir(dist))})")
    copy(bundle, dst / "ort.min.mjs")
    wasm = [p for p in dist.glob("ort-wasm*") if p.suffix in (".wasm", ".mjs")]
    if not wasm:
        die("onnxruntime-web: nerasti ort-wasm failai")
    for p in wasm:
        copy(p, dst / p.name)
    print(f"onnxruntime-web: {bundle.name} + {[p.name for p in wasm]}")


def vendor_misc(node: Path, out: Path) -> None:
    pdf = node / "pdfjs-dist" / "build"
    copy(pdf / "pdf.min.mjs", out / "vendor" / "pdfjs" / "pdf.min.mjs")
    copy(pdf / "pdf.worker.min.mjs", out / "vendor" / "pdfjs" / "pdf.worker.min.mjs")
    copy(node / "verovio" / "dist" / "verovio-toolkit-wasm.js",
         out / "vendor" / "verovio" / "verovio-toolkit-wasm.js")


def make_icons(out: Path) -> None:
    from PIL import Image, ImageDraw

    def draw(size: int, pad: float, radius: float) -> Image.Image:
        s = 1024
        img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        if radius >= 0:
            d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(radius), fill=(43, 68, 196, 255))
        else:
            d.rectangle([0, 0, s - 1, s - 1], fill=(43, 68, 196, 255))
        inner = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        di = ImageDraw.Draw(inner)
        white = (255, 255, 255, 255)
        for i in range(5):
            y = 288 + i * 128
            di.rectangle([150, y - 14, s - 150, y + 14], fill=white)
        head = Image.new("RGBA", (300, 210), (0, 0, 0, 0))
        ImageDraw.Draw(head).ellipse([0, 0, 299, 209], fill=white)
        head = head.rotate(22, expand=True, resample=Image.BICUBIC)
        inner.alpha_composite(head, (300, 560))
        di.rectangle([586, 190, 622, 700], fill=white)
        if pad:
            k = int(s * (1 - 2 * pad))
            inner = inner.resize((k, k), Image.LANCZOS)
            canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
            canvas.alpha_composite(inner, ((s - k) // 2, (s - k) // 2))
            inner = canvas
        img.alpha_composite(inner)
        return img.resize((size, size), Image.LANCZOS)

    icons = out / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    draw(192, 0, 220).save(icons / "icon-192.png")
    draw(512, 0, 220).save(icons / "icon-512.png")
    draw(512, 0.12, -1).save(icons / "icon-maskable-512.png")
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
        "<rect width='32' height='32' rx='7' fill='#2b44c4'/>"
        "<g stroke='#fff' stroke-width='1.6'><path d='M5 9h22M5 13h22M5 17h22M5 21h22M5 25h22'/></g>"
        "<ellipse cx='14' cy='22' rx='3.4' ry='2.5' fill='#fff' transform='rotate(-20 14 22)'/>"
        "<path d='M17.2 21.3V6' stroke='#fff' stroke-width='1.8'/></svg>"
    )
    (icons / "icon.svg").write_text(svg, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", required=True, type=Path)
    ap.add_argument("--node", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()
    out: Path = args.out
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)

    for p in (ROOT / "web").iterdir():
        if p.is_file():
            copy(p, out / p.name)
    (out / ".nojekyll").write_text("")

    build_homr_zip(args.engine, out / "homr.zip")
    packages, py_bytes = vendor_pyodide(args.node, out)
    py_bytes += (out / "homr.zip").stat().st_size
    vendor_ort(args.node, out)
    vendor_misc(args.node, out)
    make_icons(out)

    models = []
    for m in find_models(args.engine):
        copy(m, out / "models" / m.name)
        models.append({"file": m.name, "size": m.stat().st_size})
        print(f"modelis {m.name}: {m.stat().st_size / 1e6:.1f} MB")

    try:
        build = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                                        text=True).strip()
    except Exception:
        build = "dev"
    sw = out / "sw.js"
    sw.write_text(sw.read_text(encoding="utf-8").replace("__BUILD__", build), encoding="utf-8")

    config = {"build": build, "models": models, "packages": packages, "pythonBytes": py_bytes}
    (out / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")

    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    biggest = max((p for p in out.rglob("*") if p.is_file()), key=lambda p: p.stat().st_size)
    print(f"Svetainė: {total / 1e6:.1f} MB, didžiausias failas {biggest.name} "
          f"{biggest.stat().st_size / 1e6:.1f} MB")
    print(f"::notice title=Svetainės dydis::{total / 1e6:.1f} MB (modeliai "
          f"{sum(m['size'] for m in models) / 1e6:.1f} MB, Python {py_bytes / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
