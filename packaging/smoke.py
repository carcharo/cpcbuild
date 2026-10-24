#!/usr/bin/env python3
"""smoke.py -- unpack a CPCBuild SDK archive and build Lamplighter's lamp464 with ITS OWN tools only
(bin/zxbc, bin/mkdsk: no Python or Poetry is used to build, only to run this harness), then compare the .bin
byte for byte with a reference built by the source compiler.

  python3 packaging/smoke.py SDK_ARCHIVE REFERENCE_BIN [--keep DIR]

The zxbc flags are those of games/lamplighter/build_cpc.sh:  --arch cpc --org 0x40 -I <sdk>/lib -D CPC464
Exit status 0 only when the bytes are identical.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path


def unpack(archive: Path, dest: Path) -> Path:
    """Unpack with the platform's own tools so modes and symlinks survive (python's zipfile drops both)."""
    if archive.name.endswith(".tar.gz"):
        with tarfile.open(archive) as t:
            t.extractall(dest, filter="tar") if sys.version_info >= (3, 12) else t.extractall(dest)
    elif sys.platform == "darwin":
        subprocess.run(["ditto", "-x", "-k", str(archive), str(dest)], check=True)
    elif sys.platform == "win32":
        # Windows' own bsdtar reads zip; a GNU tar from Git for Windows earlier on PATH does not
        tar = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "tar.exe"
        subprocess.run([str(tar), "-xf", str(archive), "-C", str(dest)], check=True)
    else:
        subprocess.run(["unzip", "-q", str(archive), "-d", str(dest)], check=True)
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
        exe = ".exe" if sys.platform == "win32" else ""
        for need in (f"bin/zxbc{exe}", f"bin/mkdsk{exe}", "lib/cpcbuild.bas", "games/lamplighter/main.bas",
                     "README-FIRST.txt", "SOURCES.txt", "LICENSES/zxbasic-AGPL-3.0.txt", "LICENSES/cpcbuild-MIT.txt",
                     "LICENSES/cpcbuild-emu-GPL-3.0.txt"):
            if not (sdk / need).is_file():
                sys.exit(f"smoke: {need} is missing from the SDK")
        if sys.platform != "win32" and not os.access(sdk / "bin" / "zxbc", os.X_OK):
            sys.exit("smoke: bin/zxbc lost its execute bit")
        out = tmp / "out"
        out.mkdir(exist_ok=True)
        zxbc, mkdsk = str(sdk / "bin" / f"zxbc{exe}"), str(sdk / "bin" / f"mkdsk{exe}")
        print(run([zxbc, "--version"], sdk).strip())
        # the same invocation as Studio makes for the lamp464 target: cwd = the game folder, library = the SDK root's lib
        game = sdk / "games" / "lamplighter"
        run([zxbc, "--arch", "cpc", "--org", "0x40", "-I", str(sdk / "lib"), "-D", "CPC464",
             "-M", str(out / "lamp464.map"), "-o", str(out / "lamp464.bin"), str(game / "main.bas")], game)
        got = (out / "lamp464.bin").read_bytes()
        run([mkdsk, "-o", str(out / "LAMPLIGH.dsk"), "--load", "0x40", "--name", "LAMPLIGH", str(out / "lamp464.bin")], sdk)
        dsk = (out / "LAMPLIGH.dsk").stat().st_size
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
