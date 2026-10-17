#!/usr/bin/env python3
"""run_plus.py -- Lamplighter Plus's tests, on Caprice32 and CPCEC (chips has no Plus).

  Each test runs as the two Plus builds of build_plus.sh:
    disc  the firmware build (-D PLUS), a 6128 Plus disc run
    cart  the bare cartridge (-D PLUS -D CPC_BAREMETAL -D CPC_OWNFONT) made
          into a .cpr by mkcpr.py (Caprice32 boots it in place of the system
          cartridge; CPCEC runs the bare program)
  on both emulators (cap32, cpcec). Caprice32 draws the 12-bit colours
  differently from CPCEC, so each has its own goldens (golden/plus-cap32,
  golden/plus-cpcec); within an emulator the disc and the cartridge builds
  must give the same picture.

  logic.bas, playthrough.bas   the game logic and the whole tower (null layer,
                the same programs as the other builds: they run on the Plus
                machine too)
  plus_layer.bas  the real Plus layer: hardware sprite slots, positions and
                pictures read back from the ASIC, the sprite manager's cache,
                the flame's palette cycling
  screenshots   the 12 rooms in their entry state and the scenes of run.py
                (lit rooms, the player on a ladder, walking, the title), plus
                lit09b: lit09 four steps later, which differs from it in the
                flame's colours (palette cycling on pens 11-14; the run checks
                that the two pictures are not the same).
                Caprice32 holds the picture at the shot (-D SHOT_HOLD) and
                takes it from outside; CPCEC takes it on the program's request.

  --update   write the shots of the first variant (disc) as the new goldens
On a mismatch the actual image and a diff image are written next to the golden.
Exit status 0 if all passed.

Usage: run_plus.py [--update] [--emu cap32|cpcec] [--variant disc|cart] [-k PATTERN] [-j N]
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
REPO = GAME.parent.parent
TOOLS = REPO / "tools"
CPCRUN = TOOLS / "cpcrun.py"
GOLDEN = HERE / "golden"
ORG = "0x40"
sys.path.insert(0, str(TOOLS))


def sibling(name: str) -> Path:
    """A sibling checkout of the main working tree (a git worktree's REPO.parent is not it)."""
    p = REPO.parent / name
    if p.exists():
        return p
    common = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--git-common-dir"],
                            capture_output=True, text=True).stdout.strip()
    return (REPO / common).resolve().parent.parent / name


def main_checkout() -> Path:
    common = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--git-common-dir"],
                            capture_output=True, text=True).stdout.strip()
    return (REPO / common).resolve().parent


os.environ.setdefault("ZXBASIC", str(sibling("zxbasic")))
os.environ.setdefault("CPC_ROM_DIR", str(sibling("caprice32") / "rom"))
os.environ.setdefault("CAP32", str(main_checkout() / "tools" / "caprice32" / "work" / "src" / "cap32"))
os.environ.setdefault("CPCEC", str(main_checkout() / "tools" / "cpcec" / "work" / "cpcec"))
# the sprite manager and palette cycling (lib/cpcplus/sprman, palcycle): this
# checkout's lib/ has them once merged; until then the main checkout's
PLUSLIB = os.environ.get("PLUSLIB") or str(main_checkout() / "lib")
INC = ["-I", PLUSLIB]
import cpcrun as cpcrun_mod  # noqa: E402
import mkcpr  # noqa: E402

EMUS = ("cap32", "cpcec")
VARIANTS = ("disc", "cart")
BARE = ["CPC_BAREMETAL", "CPC_OWNFONT"]
ROOMS = range(12)

SCENES = {
    "lit09": ["SHOT=3", "SHOT_LIT", "START_ROOM=9"],
    "lit09b": ["SHOT=7", "SHOT_LIT", "START_ROOM=9"],
    "lit10": ["SHOT=3", "SHOT_LIT", "START_ROOM=10"],
    "climb": ["SHOT=3", "SHOT_CLIMB", "START_ROOM=10"],
    "walk": ["SHOT=14", "SHOT_WALK", "START_ROOM=9"],
    "title": ["SHOT=1", "SHOT_TITLE"],
}


def shot_defs(name: str) -> list[str]:
    return SCENES[name] if name in SCENES else ["SHOT=3", f"START_ROOM={int(name[4:])}"]


def zargs(defines: list[str]) -> list[str]:
    out = list(INC)
    for d in defines:
        out += ["-D", d]
    return out


def run(bas: Path, emu: str, variant: str, defines: list[str], timeout: float, shot_dir: Path | None = None,
        steps: int = 0) -> tuple[int, str]:
    """Runs bas as the disc or cartridge build on emu. Returns (exit status, the
    printer text up to the END marker)."""
    defines = ["PLUS", *defines]
    if variant == "cart":
        defines = [*BARE, *defines]
    if emu == "cpcec":
        cmd = [sys.executable, str(CPCRUN), str(bas), "--emu", "cpcec", "--model", "plus", "--org", ORG,
               "--timeout", str(timeout)]
        if variant == "cart":
            cmd.append("--bare")
        if shot_dir:
            cmd += ["--shot-dir", str(shot_dir), "--quiet"]
        for a in zargs(defines):
            cmd.append(f"--zxbc-arg={a}")
        p = subprocess.run(cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=timeout * 4 + 120)
        return p.returncode, p.stdout + (p.stderr if p.returncode else "")
    # Caprice32: the same as Starfall's plus_run
    env = cpcrun_mod.subprocess_env()
    wait = (2 * steps) // 42 + (14 if variant == "disc" else 6)
    if shot_dir:
        defines = [*defines, "SHOT_HOLD"]
    with tempfile.TemporaryDirectory(prefix="lamp-plus-") as t:
        tmp = Path(t)
        printer = tmp / "printer.dat"
        binf = tmp / "prog.bin"
        try:
            org = cpcrun_mod.compile_program(bas, binf, ["--org", ORG, *zargs(defines)], env)
            if variant == "cart":
                cpr = tmp / "prog.cpr"
                cpr.write_bytes(mkcpr.build_cpr(binf.read_bytes(), org))
                cpcrun_mod.run_emulator(None, "", printer, timeout, env, "plus", None, False, cpr,
                                        shot_dir, wait)
            else:
                dsk = tmp / "prog.dsk"
                stem = cpcrun_mod.amsdos_stem(bas)
                cpcrun_mod.pack_dsk(binf, dsk, stem, env, org)
                cpcrun_mod.run_emulator(dsk, stem, printer, timeout, env, "plus", None, False, None,
                                        shot_dir, wait)
        except cpcrun_mod.TimeoutHit:
            return 2, ""
        except cpcrun_mod.BuildError as e:
            return 1, str(e)
        text = printer.read_bytes().decode("latin-1") if printer.exists() else ""
    text = text.replace("\x04STATE\n", "")
    if cpcrun_mod.END_MARKER in text:
        return 0, text.split(cpcrun_mod.END_MARKER, 1)[0]
    return (0 if shot_dir else 4), text


def logic_test(emu: str, variant: str, src: str, timeout: float):
    label = f"{emu}/{variant}/{src.removesuffix('.bas')}"
    code, out = run(HERE / src, emu, variant, [], timeout)
    if code != 0:
        return [("ERROR", label, f"exit {code}: {out.strip()[-200:]}")]
    fails = re.findall(r"^FAIL.*$", out, re.M)
    passes = len(re.findall(r"^PASS", out, re.M))
    if fails:
        return [("FAIL", label, "; ".join(fails[:5]))]
    if "\nDONE" not in "\n" + out:
        return [("FAIL", label, "no DONE")]
    return [("PASS", label, f"{passes} checks")]


def golden_path(emu: str, name: str) -> Path:
    return GOLDEN / f"plus-{emu}" / f"{name}.png"


def take_shot(emu: str, variant: str, name: str, timeout: float):
    defs = shot_defs(name)
    steps = int([d for d in defs if d.startswith("SHOT=")][0][5:])
    if name == "title":
        steps = 50
    with tempfile.TemporaryDirectory(prefix="lamp-plus-shot-") as t:
        shot_dir = Path(t)
        code, out = run(GAME / "main.bas", emu, variant, defs, timeout, shot_dir, steps)
        if code != 0:
            return None, f"exit {code}: {out.strip()[-200:]}"
        if emu == "cap32" and not re.search(r"\x04SHOT ", out):
            return None, "no SHOT line: the game did not reach the shot (raise the wait)"
        shots = sorted(shot_dir.glob("*.png"))
        if len(shots) != 1:
            return None, f"{len(shots)} screenshots"
        return Image.open(shots[0]).convert("RGB"), ""


def shot_test(emu: str, variant: str, name: str, timeout: float, update: bool):
    label = f"{emu}/{variant}/{name}"
    a, err = take_shot(emu, variant, name, timeout)
    if a is None:
        return [("ERROR", label, err)]
    gold = golden_path(emu, name)
    actual = gold.with_suffix(f".{variant}.actual.png")
    diff = gold.with_suffix(f".{variant}.diff.png")
    if update:
        if variant != VARIANTS[0]:
            return [("PASS", label, "(goldens come from the disc build)")]
        gold.parent.mkdir(parents=True, exist_ok=True)
        had = gold.exists()
        changed = (not had) or ImageChops.difference(a, Image.open(gold).convert("RGB")).getbbox() is not None
        if changed:
            a.save(gold, optimize=True)
        for f in (actual, diff):
            f.unlink(missing_ok=True)
        return [("UPDATED" if changed else "PASS", label, "new" if not had else ("changed" if changed else ""))]
    if not gold.exists():
        actual.parent.mkdir(parents=True, exist_ok=True)
        a.save(actual)
        return [("FAIL", label, f"no golden (run with --update); actual at {actual}")]
    g = Image.open(gold).convert("RGB")
    if a.size != g.size:
        a.save(actual)
        return [("FAIL", label, f"size {a.size} != golden {g.size}")]
    d = ImageChops.difference(a, g).convert("L").point(lambda v: 255 if v else 0)
    n = d.histogram()[255]
    if n == 0:
        for f in (actual, diff):
            f.unlink(missing_ok=True)
        return [("PASS", label, "")]
    a.save(actual)
    dim = a.point(lambda v: v // 4)
    dim.paste(Image.new("RGB", a.size, (255, 0, 0)), mask=d)
    dim.save(diff)
    return [("FAIL", label, f"{n} pixels differ; see {actual.name} and {diff.name} in {gold.parent}")]


def flame_test(emu: str):
    """lit09 and lit09b (same room, same lit lamps, four steps apart) differ: the
    enemy and the flame colours move on, the player (standing) does not."""
    label = f"{emu}/flame cycling"
    a, b = golden_path(emu, "lit09"), golden_path(emu, "lit09b")
    if not a.exists() or not b.exists():
        return [("FAIL", label, "goldens missing")]
    ia, ib = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    box = ImageChops.difference(ia, ib).getbbox()
    if box is None:
        return [("FAIL", label, "lit09 and lit09b are the same picture: the flame did not cycle")]
    return [("PASS", label, f"pictures differ (box {box})")]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--update", action="store_true")
    ap.add_argument("--emu", choices=EMUS, action="append")
    ap.add_argument("--variant", choices=VARIANTS, action="append")
    ap.add_argument("-k", dest="pattern", default="")
    ap.add_argument("-j", dest="jobs", type=int, default=4)
    ap.add_argument("--timeout", type=float, default=90)
    args = ap.parse_args()
    emus = args.emu or list(EMUS)
    variants = args.variant or list(VARIANTS)
    names = [f"room{r:02d}" for r in ROOMS] + list(SCENES)
    jobs = []
    for e in emus:
        for v in variants:
            if not args.update:
                for src in ("logic.bas", "playthrough.bas", "plus_layer.bas"):
                    jobs.append((f"{e}/{v}/{src}", lambda e=e, v=v, src=src: logic_test(e, v, src, args.timeout)))
            for n in names:
                jobs.append((f"{e}/{v}/{n}", lambda e=e, v=v, n=n: shot_test(e, v, n, args.timeout, args.update)))
    jobs = [j for j in jobs if args.pattern in j[0]]
    bad = 0
    with ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for results in ex.map(lambda j: j[1](), jobs):
            for status, label, msg in results:
                print(f"{status:7} {label} {msg}".rstrip(), flush=True)
                if status in ("FAIL", "ERROR"):
                    bad += 1
    if not args.update and not args.pattern:
        for e in emus:
            for status, label, msg in flame_test(e):
                print(f"{status:7} {label} {msg}".rstrip(), flush=True)
                if status == "FAIL":
                    bad += 1
    print(f"{len(jobs)} tests, {bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
