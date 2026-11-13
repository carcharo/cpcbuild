#!/usr/bin/env python3
"""pack_dsk.py -- packs Starfall's CPC files into one AMSDOS disc image.

    pack_dsk.py OUT.dsk NAME=FILE@LOAD[:EXEC] ...

Each argument adds FILE to the disc as the AMSDOS file NAME (8.3), with an
AMSDOS header giving the load address LOAD (and the entry address EXEC, by
default LOAD), e.g.

    pack_dsk.py starfall.dsk DISC.BIN=loader.bin@0x9E00 \\
        STARFALL.BIN=starfall.bin@0x40 STARFA64.BIN=starfa64.bin@0x40

The disc is written by `cpcbas dsk` (CPCBAS, default the sibling checkout
../cpcbas). Each FILE is the bare image, with no AMSDOS header: cpcbas dsk
writes it.
"""
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CPCBAS = Path(os.environ.get("CPCBAS", HERE.parent.parent.parent / "cpcbas"))
CLI = CPCBAS / "packages" / "cpcbas" / "dist" / "bin" / "cpcbas.js"


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    if not CLI.is_file():
        print(f"pack_dsk: cpcbas not built at {CLI} (set CPCBAS)", file=sys.stderr)
        return 1
    specs = []
    for spec in argv[2:]:
        name, _, rest = spec.partition("=")
        specs.append(f"{name.upper()}={rest}")
    proc = subprocess.run(["node", str(CLI), "dsk", "-o", argv[1], *specs], capture_output=True, text=True)
    if proc.returncode:
        print(f"pack_dsk: cpcbas dsk failed: {proc.stderr.strip()}", file=sys.stderr)
        return 1
    print(f"pack_dsk: wrote {argv[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
