#!/usr/bin/env python3
"""disc.py -- Starfall's disc in Caprice32 (headless): RUN"DISC picks the
right firmware build for the machine, RUN"BARE the right bare-metal one
(on a 6128 after putting the songs into extra RAM bank 0 itself).

Builds the discs from games/shooter/build (run build_cpc.sh first), then for
each model boots

  * the full disc: the game's title screen must be up (a black playfield);
  * a disc without the build that model should load (6128: STARFALL.BIN,
    464: STARFA64.BIN): the loader must fail (BASIC's blue screen with its
    message), which shows it chose that file;
  * a disc with only that build: the title screen again.

The same three for RUN"BARE with STARBARE.BIN (6128) / STARBA64.BIN (464).

A 464 is a stock 64 KB machine with the DDI-1 disc ROM; the 6128 has 128 KB.
Needs Caprice32 ($CAP32, default tools/caprice32/work/src/cap32, else ../caprice32/cap32). Not part of the chips
CI. Exit status 0 if all passed.
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
BUILD = GAME / "build"
REPO = GAME.parent.parent
sys.path.insert(0, str(REPO / "tools"))
from cpcrun import cap32_bin  # noqa: E402

CAP32 = cap32_bin()
DELAYS = 14


def disc(path, files):
    cmd = [sys.executable, str(GAME / "pack_dsk.py"), str(path)]
    for name, f, load in files:
        cmd.append(f"{name}={BUILD / f if f != 'starfall.dat' else GAME / 'assets' / f}@{load}")
    subprocess.run(cmd, check=True, capture_output=True)


def boot(dsk, model, tmp, cmdline='run"disc'):
    shots = Path(tmp) / "shots"
    shots.mkdir(exist_ok=True)
    for f in shots.glob("*.png"):
        f.unlink()
    opts = ["-O", "system.model=2"] if model == "6128" else \
        ["-O", "system.model=0", "-O", "rom.slot07=amsdos.rom", "-O", "system.ram_size=64"]
    cmd = [str(CAP32), *opts, "-O", "sound.enabled=0", "-O", f"file.sdump_dir={shots}",
           "-a", cmdline, "-a", "CAP32_DELAY" * DELAYS + "CAP32_SCRNSHOT", "-a", "CAP32_EXIT", str(dsk)]
    env = dict(os.environ, SDL_VIDEODRIVER="dummy")
    subprocess.run(cmd, env=env, capture_output=True, timeout=120)
    pngs = sorted(shots.glob("*.png"))
    return Image.open(pngs[0]).convert("RGB") if pngs else None


def is_game(im):
    # the playfield is black, BASIC's screen blue
    return im is not None and im.getpixel((380, 250)) == (0, 0, 0)


def main():
    for f in ("starfall.bin", "starfa64.bin", "loader.bin", "bare.bin", "starbare.bin", "starba64.bin"):
        if not (BUILD / f).exists():
            print(f"disc.py: {BUILD / f} missing: run games/shooter/build_cpc.sh first")
            return 2
    D = ("STARFALL.DAT", "starfall.dat", "0x4000")
    SETS = (
        ("run\"disc", ("DISC.BIN", "loader.bin", "0x9E00"),
         ("STARFALL.BIN", "starfall.bin", "0x40"), ("STARFA64.BIN", "starfa64.bin", "0x40")),
        ("run\"bare", ("BARE.BIN", "bare.bin", "0x9E00"),
         ("STARBARE.BIN", "starbare.bin", "0x40"), ("STARBA64.BIN", "starba64.bin", "0x40")),
    )
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        for cmdline, L, A, B in SETS:
            for model, mine, other in (("6128", A, B), ("464", B, A)):
                for label, files, want in (("full disc", [L, A, B, D], True),
                                           ("without its build", [L, other, D], False),
                                           ("only its build", [L, mine, D], True)):
                    dsk = Path(tmp) / "t.dsk"
                    disc(dsk, files)
                    im = boot(dsk, model, tmp, cmdline)
                    ok = is_game(im) == want
                    bad += not ok
                    print(f"{'PASS' if ok else 'FAIL'} {model} {cmdline}: {label}: " +
                          ("game running" if is_game(im) else "no game"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
