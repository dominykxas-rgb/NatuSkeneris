"""Atpažinimas naršyklėje: tas pats kelias kaip Penklinės exe programoje.

Failai įrašomi į /work/in, rezultatas grąžinamas kaip MusicXML tekstas.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import stubs

stubs.install()

from homr.main import ProcessingConfig, run_homr  # noqa: E402
from homr.music_xml_generator import XmlGeneratorArguments  # noqa: E402
from photo_prep import prepare_image  # noqa: E402

WORK = Path("/work")


def recognize(names: list[str], flatten: bool = True) -> str:
    out = WORK / "out"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    inputs: list[str] = []
    for name in names:
        prepared, note = prepare_image(WORK / "in" / name, out, flatten=flatten)
        if note:
            print(f"{name}: {note}", flush=True)
        inputs.append(str(prepared))

    config = ProcessingConfig(
        enable_debug=False,
        enable_cache=False,
        write_staff_positions=False,
        read_staff_positions=False,
        selected_staff=-1,
        transformer_use_gpu=False,
        segnet_use_gpu=False,
        coreml_encoder=False,
        title_detection=False,
    )
    run_homr(inputs, config, XmlGeneratorArguments(False, None, None))

    results = sorted(out.glob("*.musicxml"), key=lambda p: p.stat().st_mtime)
    if not results:
        raise RuntimeError("Natų atpažinti nepavyko.")
    return results[-1].read_text(encoding="utf-8")
