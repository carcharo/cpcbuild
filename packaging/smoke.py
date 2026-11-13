#!/usr/bin/env python3
"""smoke.py -- unpack a CPCBuild SDK archive and build Lamplighter's lamp464 with ITS OWN compiler
(`node bin/cpcbas.mjs`: the harness needs only Python and Node), then compare the .bin byte for byte with a
reference built by the checked-out cpcbas.

  python3 packaging/smoke.py SDK_ARCHIVE REFERENCE_BIN [--keep DIR]

The flags are those of the Studio's lamp464 target: --org 0x40 -D CPC464, run in the game folder.
Exit status 0 only when the bytes are identical.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

NEEDED = ("bin/cpcbas.mjs", "lib/runtime/stub.asm", "games/lamplighter/main.bas", "games/shooter/main.bas",
          "README-FIRST.txt", "SOURCES.txt", "LICENSES/cpcbas-AGPL-3.0.txt", "LICENSES/cpcbas-NOTICE.txt",
          "LICENSES/cpcbuild-MIT.txt", "LICENSES/cpcbuild-emu-GPL-3.0.txt", "LICENSES/NOTICE.txt")


def unpack(archive: Path, dest: Path) -> Path:
    with zipfile.ZipFile(archive) as z:
        z.extractall(dest)
    roots = [p for p in dest.iterdir() if p.is_dir()]
    if len(roots) != 1 or not roots[0].name.startswith("cpcbuild-sdk-"):
        sys.exit(f"smoke: {archive.name} does not unpack to one cpcbuild-sdk-* folder: {[p.name for p in roots]}")
    return roots[0]


def run(cmd: list[str], cwd: Path) -> str:
    print("+", " ".join(cmd), flush=True)
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    sys.stdout.write((r.stdout or "") + (r.stderr or ""))
    if r.returncode:
        sys.exit(f"smoke: exit status {r.returncode}")
    return r.stdout


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("archive")
    ap.add_argument("reference")
    ap.add_argument("--keep", help="unpack into this (empty or new) folder and leave it")
    a = ap.parse_args()
    ref = Path(a.reference).read_bytes()
    tmp = Path(a.keep) if a.keep else Path(tempfile.mkdtemp(prefix="cpcsdk-"))
    tmp.mkdir(parents=True, exist_ok=True)
    try:
        sdk = unpack(Path(a.archive).resolve(), tmp)
        for need in NEEDED:
            if not (sdk / need).is_file():
                sys.exit(f"smoke: {need} is missing from the SDK")
        if sorted(p.name for p in (sdk / "bin").iterdir()) != ["cpcbas.mjs"]:
            sys.exit("smoke: bin/ holds more than cpcbas.mjs")
        for vsix in ("studio", "emu"):
            if not list(sdk.glob(f"cpcbuild-{vsix}-*.vsix")):
                sys.exit(f"smoke: the {vsix} .vsix is missing from the SDK")
        out = tmp / "out"
        out.mkdir(exist_ok=True)
        cli = ["node", str(sdk / "bin" / "cpcbas.mjs")]
        print(run([*cli, "--version"], sdk).strip())
        game = sdk / "games" / "lamplighter"
        run([*cli, "--org", "0x40", "-D", "CPC464", "-M", str(out / "lamp464.map"),
             "-o", str(out / "lamp464.bin"), str(game / "main.bas")], game)
        got = (out / "lamp464.bin").read_bytes()
        # the disc image path too (the same compile, packed on an AMSDOS disc)
        run([*cli, "--org", "0x40", "-D", "CPC464", "-o", str(out / "lamp464.dsk"), str(game / "main.bas")], game)
        dsk = (out / "lamp464.dsk").stat().st_size
        h = hashlib.sha256(got).hexdigest()
        print(f"lamp464.bin {len(got)} bytes sha256 {h[:16]}  reference {len(ref)} bytes  dsk {dsk} bytes")
        if dsk < len(got):
            sys.exit("smoke: the .dsk is smaller than the program")
        if got != ref:
            sys.exit("smoke: lamp464.bin differs from the reference")
        print("smoke: OK, byte-identical")
    finally:
        if not a.keep:
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
