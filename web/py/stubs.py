"""Tušti moduliai, kurių homr importuoja, bet naršyklėje nenaudoja.

- rapidocr: pavadinimo atpažinimas (išjungtas, --no-title)
- pypdfium2: PDF paverčiami paveikslėliais naršyklėje per pdf.js
- requests: modeliai atsiunčiami per naršyklę
"""

import sys
import types


def install() -> None:
    rapidocr = types.ModuleType("rapidocr")

    class RapidOCR:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("Pavadinimo atpažinimas naršyklėje nepalaikomas")

    rapidocr.RapidOCR = RapidOCR
    utils = types.ModuleType("rapidocr.utils")
    output = types.ModuleType("rapidocr.utils.output")

    class RapidOCROutput:
        pass

    output.RapidOCROutput = RapidOCROutput
    utils.output = output
    rapidocr.utils = utils
    sys.modules.setdefault("rapidocr", rapidocr)
    sys.modules.setdefault("rapidocr.utils", utils)
    sys.modules.setdefault("rapidocr.utils.output", output)

    pdfium = types.ModuleType("pypdfium2")
    sys.modules.setdefault("pypdfium2", pdfium)

    requests = types.ModuleType("requests")

    def _no_network(*args, **kwargs):
        raise RuntimeError("Tinklas iš Python naršyklėje nenaudojamas")

    requests.get = _no_network
    sys.modules.setdefault("requests", requests)
