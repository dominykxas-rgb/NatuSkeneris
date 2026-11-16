"""Paveikslėlių paruošimo variantai, kuriuos lyginame.

Kiekvienas variantas: (šaltinis.png, tikslas.png, prepare_image) -> pastaba arba None.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import cv2
import numpy as np


def raw(src: Path, dst: Path, prepare_image) -> str | None:
    """Paveikslėlis kaip yra (taip matuoja ir homr autorius)."""
    shutil.copy(src, dst)
    return None


def prep(src: Path, dst: Path, prepare_image) -> str | None:
    """Dabartinis Penklinės paruošimas: EXIF pasukimas ir lapo ištiesinimas."""
    tmp_dir = dst.parent / "_prep"
    tmp_dir.mkdir(exist_ok=True)
    out, note = prepare_image(src, tmp_dir, flatten=True)
    shutil.move(str(out), dst)
    return note


def clahe(src: Path, dst: Path, prepare_image) -> str | None:
    """Lokalus kontrasto išlyginimas (šešėliams ir netolygiam apšvietimui)."""
    img = cv2.imread(str(src))
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l)
    cv2.imwrite(str(dst), cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR))
    return None


def shading(src: Path, dst: Path, prepare_image) -> str | None:
    """Fono (šešėlių) pašalinimas: padalinam iš išblukinto fono."""
    gray = cv2.cvtColor(cv2.imread(str(src)), cv2.COLOR_BGR2GRAY)
    k = max(31, (min(gray.shape) // 20) | 1)
    bg = cv2.medianBlur(cv2.dilate(gray, np.ones((7, 7), np.uint8)), k)
    norm = cv2.divide(gray, bg, scale=255)
    cv2.imwrite(str(dst), norm)
    return None


VARIANTS = {"raw": raw, "prep": prep, "clahe": clahe, "shading": shading}
