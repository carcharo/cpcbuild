#!/usr/bin/env python3
"""palette_check.py -- checks cpcbuild's firmware-colour -> Gate Array
table (the fork's runtime/gacolour.asm, __CPC_HWCOL) against the firmware, in
the emulator, by comparing screenshots.

    palette_check.py [--model 464|6128] [--emu cap32|chips] [--keep DIR]

For each of three paths a generated BASIC program steps through 27
states (state s: border = colour s, pen p = colour (p+s) mod 27 for
pens 0-15, each pen shown as a column of blank text cells). After each
state the harness takes a screenshot and types "q" (then RETURN, ignored)
to advance; the program waits for that q.

  fw   firmware only (SCR_SET_INK/SCR_SET_BORDER, then flyback waits
       through the firmware, so its interrupt writes the palette): the
       reference.
  hw   Gate Array only, through __CPC_GA_SET, no firmware call at all
       while a state is shown: the table. Interrupts are off from the last
       Gate Array write until the next state's first one (the q is read
       straight from the PPI, WaitQDi), because the firmware's interrupt
       handler rewrites all 17 inks from its own tables every flash period
       (10 frames, whether or not any ink flashes), which would wipe
       writes that bypass the firmware (__CPC_GA_SET returns with interrupts
       on, and so does ScanKeys, so a window is left between the last
       write and the DI: microseconds, tolerated).
  lib  the library's own SetBorder + SetPalette, again with no firmware
       call while the state is shown: firmware and direct together.

Pass criteria: for every state the border pixel and all 16 pen cells have
the same RGB in hw and lib as in fw, and the 27 border RGBs are distinct.
Exit status 0 if all of that holds. Needs PIL, the zxbasic fork and
caprice32 (see tools/cpcrun.py).

--emu chips runs the same programs on tools/chipsrun instead (no typed q:
the program triggers each screenshot itself with tests/screens/lib/shot.bas
and the colours are chips' Gate Array table, not Caprice32's). Note that
this checks the library against the firmware *on the same emulator*: both
the fw and the hw/lib paths show colours through chips' hardware colour
table, so agreement says the firmware->Gate Array mapping is right, and
the 27 distinct RGBs say chips' table has them all.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cpcrun  # noqa: E402
from PIL import Image  # noqa: E402

STEPS = 27
SHOT_LIB = Path(__file__).resolve().parent.parent / "tests" / "screens" / "lib" / "shot.bas"

PROGRAM = r"""
#include <cpc.bas>
#include <cpcbuild/palette.bas>
#include <cpcbuild/keyboard.bas>

DIM pal(15) AS UBYTE
DIM s, p AS UBYTE

SUB Cell(pen AS UBYTE, col AS UBYTE, row AS UBYTE)
  ASM
  ld a, (ix+5)
  call .core.__FW_CALL
  defw $BB96
  ld h, (ix+7)
  ld l, (ix+9)
  call .core.__FW_CALL
  defw $BB75
  ld a, 32
  call .core.__FW_CALL
  defw $BB5A
  END ASM
END SUB

REM Firmware only.
SUB FwInk(pen AS UBYTE, colour AS UBYTE)
  ASM
  ld a, (ix+5)
  ld b, (ix+7)
  ld c, b
  call .core.__FW_CALL
  defw $BC32
  END ASM
END SUB
SUB FASTCALL FwBorder(colour AS UBYTE)
  ASM
  ld b, a
  ld c, a
  call .core.__FW_CALL
  defw $BC38
  END ASM
END SUB

REM Gate Array only (the table in palette.asm).
SUB HwInk(pen AS UBYTE, colour AS UBYTE)
  ASM
  ld a, (ix+5)
  ld c, (ix+7)
  call .core.__CPC_GA_SET
  END ASM
END SUB
SUB HwBorder(colour AS UBYTE)
  ASM
  ld c, (ix+5)
  ld a, 16
  call .core.__CPC_GA_SET
  END ASM
END SUB

REM Waits for the typed Q with no firmware call, then for its release.
SUB WaitQDirect
  DO
    ScanKeys()
  LOOP UNTIL KeyDown(KEY_Q)
  DO
    ScanKeys()
  LOOP UNTIL KeyDown(KEY_Q) = 0
END SUB

REM The same wait, with interrupts off throughout (ScanKeys returns with
REM them on): reads row 8 (Q is bit 3) straight from the PPI, as
REM __CB_SCAN_KEYS does, and returns with interrupts still off.
SUB WaitQDi
  ASM
  di
  ld b, $F6
  in a, (c)
  and $30
  ld d, a
  ld bc, $F40E
  out (c), c
  ld b, $F6
  or $C0
  out (c), a
  out (c), d
  ld bc, $F792
  out (c), c
  ld a, d
  or $48
  ld e, a
waitq_down:
  ld b, $F6
  out (c), e
  ld b, $F4
  in a, (c)
  bit 3, a
  jr nz, waitq_down
waitq_up:
  ld b, $F6
  out (c), e
  ld b, $F4
  in a, (c)
  bit 3, a
  jr z, waitq_up
  ld bc, $F782
  out (c), c
  ld b, $F6
  out (c), d
  END ASM
END SUB

Mode 0
FOR p = 0 TO 15
  FOR s = 5 TO 9
    Cell(p, p + 1, s)
  NEXT s
NEXT p

FOR s = 0 TO 26
  FOR p = 0 TO 15
    pal(p) = (p + s) MOD 27
  NEXT p
  @@STEP@@
NEXT s
"""

STEP = {
    "fw": """FwBorder(s)
  FOR p = 0 TO 15
    FwInk(p, pal(p))
  NEXT p
  WaitVsync: WaitVsync: WaitVsync: WaitVsync
  DO
  LOOP UNTIL INKEY$ = "q"
""",
    "hw": """HwBorder(s)
  FOR p = 0 TO 15
    HwInk(p, pal(p))
  NEXT p
  ASM
  di
  END ASM
  WaitQDi()
  ASM
  ei
  END ASM
""",
    "lib": """SetBorder(s)
  SetPalette(@pal(0), 16)
  WaitQDirect()
""",
}


# chips: same states, but the program takes its own shot (Shot) instead of
# waiting for a typed q. The fw path waits 4 flybacks first so the
# firmware's own interrupt has written the palette.
CHIPS_STEP = {
    "fw": STEP["fw"].replace("""  DO
  LOOP UNTIL INKEY$ = "q"
""", "CHIPS_SHOT"),
    # (the hw step already holds interrupts off from its last Gate Array
    # write: see the module docstring)
    "hw": STEP["hw"].replace("WaitQDi()", "CHIPS_SHOT"),
    "lib": STEP["lib"].replace("WaitQDirect()", "CHIPS_SHOT"),
}
CHIPS_SHOT = 'Shot("s" + CHR$(48 + s / 10) + CHR$(48 + s MOD 10))\n'


def run_path_chips(path: str, model: str, workdir: Path, env: dict) -> list[Path]:
    bas = workdir / f"pal{path}.bas"
    step = CHIPS_STEP[path].replace("CHIPS_SHOT", CHIPS_SHOT)
    text = PROGRAM.replace("@@STEP@@", step).replace(
        "#include <cpcbuild/keyboard.bas>", f'#include <cpcbuild/keyboard.bas>\n#include "{SHOT_LIB}"')
    bas.write_text(text)
    shots = workdir / f"shots_{path}"
    shots.mkdir()
    code = cpcrun.main([str(bas), "--emu", "chips", "--model", model, "--shot-dir", str(shots), "--quiet",
                        "--timeout", "120"])
    if code != 0:
        print(f"  cpcrun exited {code}")
    return sorted(shots.glob("*.png"))


def run_path(path: str, model: str, workdir: Path, env: dict) -> list[Path]:
    bas = workdir / f"pal{path}.bas"
    bas.write_text(PROGRAM.replace("@@STEP@@", STEP[path]))
    out_bin = workdir / f"{path}.bin"
    dsk = workdir / f"{path}.dsk"
    stem = cpcrun.amsdos_stem(bas)
    cpcrun.compile_program(bas, out_bin, [], env)
    cpcrun.pack_dsk(out_bin, dsk, stem, env)
    shots = workdir / f"shots_{path}"
    shots.mkdir()
    cmd = [str(cpcrun.cap32_bin())]
    cfg = cpcrun.cap32_bin().parent / "cap32.cfg"
    if cfg.exists():
        cmd += ["-c", str(cfg)]
    cmd += ["-O", "sound.enabled=0", "-O", f"system.model={cpcrun.MODELS[model]}", "-O", "rom.slot07=amsdos.rom",
            "-O", f"file.sdump_dir={shots}", "-a", f'run"{stem}']
    # One token per state: wait, screenshot, type q (cap32 types RETURN
    # after each token too, which the program ignores).
    for i in range(STEPS):
        cmd += ["-a", "CAP32_DELAY" * (8 if i == 0 else 2) + "CAP32_SCRNSHOTq"]
    cmd += ["-a", "CAP32_EXIT", str(dsk)]
    run_env = dict(env, SDL_VIDEODRIVER="dummy")
    try:
        subprocess.run(cmd, env=run_env, capture_output=True, timeout=240)
    except subprocess.TimeoutExpired:
        pass
    files = sorted(shots.glob("*.png"))
    return files


def sample_chips(png: Path):
    """The same for chipsrun's 768x272 shot (tools/chipsrun/chipsrun.c): one
    pixel per mode-2 pixel across and per scanline down; the 640x200 screen
    starts at (64, 36); a mode 0 text cell is 32x8 of those pixels (pen p's
    column is column p, rows 5-9 are y 76-115). The border is sampled at
    the left edge."""
    im = Image.open(png).convert("RGB")
    assert im.size == (768, 272), im.size
    return im.getpixel((10, 136)), [im.getpixel((64 + 32 * p + 16, 96)) for p in range(16)]


def sample(png: Path):
    """(border RGB, [16 pen cell RGBs]) of one screenshot. cap32's shot is
    768x540: the 640x400 screen starts at (64, 82); a mode 0 text cell is
    32x16 of those pixels, pen p's column is column p (0-based), and its
    rows 5-9 (1-based) are y 146-225. The border is sampled at the right
    edge (the top-left holds cap32's "50FPS" overlay)."""
    im = Image.open(png).convert("RGB")
    assert im.size == (768, 540), im.size
    border = im.getpixel((740, 270))
    cells = [im.getpixel((64 + 32 * p + 16, 186)) for p in range(16)]
    return border, cells


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", choices=["464", "6128"], default="6128")
    ap.add_argument("--emu", choices=["cap32", "chips"], default="cap32")
    ap.add_argument("--keep", type=Path, help="keep screenshots and programs in this directory")
    args = ap.parse_args()
    env = cpcrun.subprocess_env()
    workdir = Path(tempfile.mkdtemp(prefix="palcheck-"))
    try:
        results = {}
        for path in ("fw", "hw", "lib"):
            files = (run_path_chips if args.emu == "chips" else run_path)(path, args.model, workdir, env)
            print(f"{path}: {len(files)} screenshots")
            if len(files) != STEPS:
                print("  expected", STEPS, "- aborting")
                return 2
            results[path] = [(sample_chips if args.emu == 'chips' else sample)(f) for f in files]
        bad = 0
        for path in ("hw", "lib"):
            for s in range(STEPS):
                rb, rc = results["fw"][s]
                b, c = results[path][s]
                if b != rb:
                    bad += 1
                    print(f"{path} state {s}: border {b} != firmware {rb}")
                for p in range(16):
                    if c[p] != rc[p]:
                        bad += 1
                        print(f"{path} state {s} pen {p} (colour {(p + s) % 27}): {c[p]} != firmware {rc[p]}")
        borders = [results["fw"][s][0] for s in range(STEPS)]
        if len(set(borders)) != 27:
            bad += 1
            print("the 27 firmware colours are not 27 distinct RGBs:", len(set(borders)))
        for s in range(STEPS):
            print(f"colour {s:2d}: firmware RGB {results['fw'][s][0]}")
        print("OK" if not bad else f"{bad} MISMATCHES")
        return 1 if bad else 0
    finally:
        if args.keep:
            shutil.copytree(workdir, args.keep, dirs_exist_ok=True)
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
