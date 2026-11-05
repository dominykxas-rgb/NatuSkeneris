"""Paleidžia homr atpažinimo variklį (https://github.com/liebharc/homr, AGPL-3.0).

Kūrimo režimu variklis yra aplanke engine/homr. Pvz.:
    python app/run_homr.py --init --no-title
"""

import sys

from homr_entry import run

if __name__ == "__main__":
    sys.exit(run(sys.argv[1:]))
