"""Nuotraukų paruošimas prieš atpažinimą.

- pasuka nuotrauką pagal telefono EXIF informaciją;
- suranda lapą nuotraukoje ir ištiesina perspektyvą (jei lapas aiškiai matomas);
- paverčia kitus formatus (webp, bmp, tiff, heic jei palaikoma) į PNG.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

try:  # iPhone HEIC nuotraukos
    from pillow_heif import register_heif_opener

    register_heif_opener()
except Exception:  # pragma: no cover
    pass

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif"}


def _order_corners(pts: np.ndarray) -> np.ndarray:
    pts = pts.reshape(4, 2).astype("float32")
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(d)]
    bl = pts[np.argmax(d)]
    return np.array([tl, tr, br, bl], dtype="float32")


def _find_page(img: np.ndarray) -> np.ndarray | None:
    """Grąžina 4 lapo kampus arba None, jei lapo aiškiai nesimato."""
    h, w = img.shape[:2]
    scale = 1000.0 / max(h, w)
    small = cv2.resize(img, (int(w * scale), int(h * scale))) if scale < 1 else img.copy()
    if scale >= 1:
        scale = 1.0
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((5, 5), np.uint8), iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    area_total = small.shape[0] * small.shape[1]
    for c in sorted(contours, key=cv2.contourArea, reverse=True)[:5]:
        area = cv2.contourArea(c)
        if area < 0.25 * area_total:
            break
        approx = cv2.approxPolyDP(c, 0.02 * cv2.arcLength(c, True), True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            # Jei lapas užima beveik visą kadrą, ištiesinti nebereikia.
            if area > 0.97 * area_total:
                return None
            return _order_corners(approx) / scale
    return None


def _warp(img: np.ndarray, corners: np.ndarray) -> np.ndarray:
    tl, tr, br, bl = corners
    width = int(max(np.linalg.norm(br - bl), np.linalg.norm(tr - tl)))
    height = int(max(np.linalg.norm(tr - br), np.linalg.norm(tl - bl)))
    dst = np.array([[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]], "float32")
    m = cv2.getPerspectiveTransform(corners, dst)
    warped = cv2.warpPerspective(img, m, (width, height), flags=cv2.INTER_CUBIC)
    # Nukerpam ploną kraštą, kuriame dar gali matytis stalas.
    mx, my = max(2, int(width * 0.012)), max(2, int(height * 0.012))
    return warped[my:height - my, mx:width - mx]


def prepare_image(src: Path, dst_dir: Path, flatten: bool = True) -> tuple[Path, str]:
    """Paruošia vieną paveikslėlį. Grąžina (naujas_kelias, pastaba)."""
    note = ""
    try:
        pil = Image.open(src)
    except Exception as exc:  # pragma: no cover - priklauso nuo formato
        raise RuntimeError(
            f"Nepavyko atidaryti {src.name}. Išsaugok nuotrauką kaip JPG arba PNG."
        ) from exc
    pil = ImageOps.exif_transpose(pil).convert("RGB")
    img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)

    if flatten:
        corners = _find_page(img)
        if corners is not None:
            img = _warp(img, corners)
            note = "lapas ištiesintas"

    out = dst_dir / f"{src.stem}.png"
    cv2.imwrite(str(out), img)
    return out, note
