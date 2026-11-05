"""homr atpažinimo variklio paleidimas atskirame procese.

Naudojama ir kūrimo režimu (python run_homr.py ...), ir exe režimu (NatuSkeneris.exe --homr ...).
Variklio išvestis rašoma į žurnalo failą (--log), nes exe be konsolės neturi stdout.
"""

from __future__ import annotations

import sys
from pathlib import Path


def run(argv: list[str]) -> int:
    args = list(argv)
    log_path = None
    if "--log" in args:
        i = args.index("--log")
        log_path = args[i + 1]
        del args[i:i + 2]
    if log_path:
        stream = open(log_path, "w", encoding="utf-8", buffering=1)  # noqa: SIM115
        sys.stdout = sys.stderr = stream
    elif sys.stderr is None:
        sys.stdout = sys.stderr = open("homr.log", "w", encoding="utf-8", buffering=1)  # noqa: SIM115

    if not getattr(sys, "frozen", False):
        engine = Path(__file__).resolve().parent.parent / "engine"
        sys.path.insert(0, str(engine))

    from homr.main import main

    sys.argv = ["homr", *args]
    try:
        main()
    except SystemExit as exc:
        return int(exc.code or 0)
    except Exception:
        import traceback

        traceback.print_exc()
        return 1
    finally:
        sys.stdout.flush()
    return 0
