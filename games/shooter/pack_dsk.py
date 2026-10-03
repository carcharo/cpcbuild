#!/usr/bin/env python3
"""pack_dsk.py -- packs Starfall's CPC files into one AMSDOS disc image.

    pack_dsk.py OUT.dsk NAME=FILE@LOAD[:EXEC] ...

Each argument adds FILE to the disc as the AMSDOS file NAME (8.3), with an
AMSDOS header giving the load address LOAD (and the entry address EXEC, by
default LOAD), e.g.

    pack_dsk.py starfall.dsk DISC.BIN=loader.bin@0x8000 \
        STARFALL.BIN=starfall.bin@0x40 STARFA64.BIN=starfa64.bin@0x40

Uses the compiler fork's tools/cpc/mkdsk.py (ZXBASIC, default ../zxbasic).
"""
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ZX = Path(os.environ.get("ZXBASIC", HERE.parent.parent.parent / "zxbasic"))
sys.path.insert(0, str(ZX / "tools" / "cpc"))
import mkdsk  # noqa: E402


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    disk = mkdsk.DiskImage()
    for spec in argv[2:]:
        name, _, rest = spec.partition("=")
        path, _, addrs = rest.partition("@")
        load, _, ex = addrs.partition(":")
        load_addr = int(load, 0)
        exec_addr = int(ex, 0) if ex else load_addr
        disk.add_file(name.upper(), Path(path).read_bytes(), load_addr=load_addr, exec_addr=exec_addr)
    Path(argv[1]).write_bytes(disk.to_dsk_bytes())
    print(f"pack_dsk: wrote {argv[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
