"""NatuSkeneris.exe paleidimo taškas.

Exe neturi konsolės, todėl bet kokia klaida paleidžiant būtų parodyta kaip langas, kuris
laukia paspaudimo (ir „pakimba“ automatiniame tikrinime). Čia klaidos įrašomos į failą:
- režimu --selftest: į rezultatų aplanką (crash.log);
- režimu --homr: į variklio žurnalą (--log failą);
- įprastai: į %LOCALAPPDATA%\\NatuSkeneris\\klaida.log ir parodomos trumpu pranešimu.
"""

import os
import sys
import traceback
from pathlib import Path


def _crash_file() -> Path:
    args = sys.argv[1:]
    if args[:1] == ["--selftest"] and len(args) >= 3:
        out = Path(args[2])
        out.mkdir(parents=True, exist_ok=True)
        return out / "crash.log"
    if args[:1] == ["--homr"] and "--log" in args:
        i = args.index("--log")
        if i + 1 < len(args):
            return Path(args[i + 1]).with_name("homr-crash.log")
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "NatuSkeneris"
    base.mkdir(parents=True, exist_ok=True)
    return base / "klaida.log"


def _headless() -> bool:
    return sys.argv[1:2] in (["--selftest"], ["--homr"])


def _report(text: str) -> None:
    try:
        _crash_file().write_text(text, encoding="utf-8")
    except Exception:
        pass
    if sys.stderr is not None:
        try:
            sys.stderr.write(text)
        except Exception:
            pass
    if not _headless() and os.name == "nt":
        try:
            import ctypes

            ctypes.windll.user32.MessageBoxW(
                None,
                "Natų skeneris susidūrė su klaida ir užsidarys.\n\n"
                + text[-1500:]
                + f"\n\nVisa informacija: {_crash_file()}",
                "Natų skeneris",
                0x10,
            )
        except Exception:
            pass


def _start() -> None:
    import faulthandler

    if _headless():
        # Jei kažkas užstrigtų, kas 2 min. įrašom, kur programa stovi.
        stack = open(_crash_file().with_suffix(".stack.log"), "w", encoding="utf-8")  # noqa: SIM115
        faulthandler.dump_traceback_later(120, repeat=True, file=stack)

    import multiprocessing

    multiprocessing.freeze_support()
    import natu_skeneris

    natu_skeneris.main()


if __name__ == "__main__":
    try:
        _start()
    except SystemExit:
        raise
    except BaseException:
        _report(traceback.format_exc())
        os._exit(3)
