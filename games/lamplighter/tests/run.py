#!/usr/bin/env python3
"""run.py -- Lamplighter's CPC tests, headless on the chips emulator.

  logic.bas     the game logic tests (null layer), both models: every
                "PASS name" line, no "FAIL", and DONE.
  playthrough.bas  the whole tower played with the input sequence of
                playseq.bas (made by reach.py): all 28 lamps, the game won.
                The sound switches (-D NOMUSIC, NOSFX, NOSOUND) must not
                change a pixel of room 9
  screenshots   each of the 12 rooms in its entry state (-D START_ROOM=n -D
                SHOT=3: the player on the room's start cell after 3 logic
                steps), and five scenes (SCENES: lit rooms with the door
                open, the player on a ladder, walking and jumping, the title) of the real builds (464: -D CPC464, 6128: -D CPC6128),
                compared pixel for pixel with golden/<model>/room<nn>.png.
                A shot is the visible display, 768x272 RGB (chipsrun) on the CPC, 320x256 on the Spectrum builds (zx48, zx128: -D ZX48 / ZX128, run by zxrun.py).

  --update   write the shots as the new goldens
On a mismatch the actual image and a diff image (differing pixels in red over
a dimmed copy) are written next to the golden. Exit status 0 if all passed.

Usage: run.py [--update] [--model 464|6128|zx48|zx128] [-k PATTERN] [--timeout S]
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
CPCRUN = REPO / "tools" / "cpcrun.py"
ZXRUN = REPO / "tools" / "zxrun.py"
GOLDEN = HERE / "golden"
MODELS = ("464", "6128", "zx48", "zx128")
ROOMS = range(12)
ORG = "0x40"


def sibling(name: str) -> Path:
    """The sibling checkout (../zxbasic, ../caprice32) of the main working
    tree: in a git worktree REPO.parent is not the right place."""
    p = REPO.parent / name
    if p.exists():
        return p
    common = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--git-common-dir"],
                            capture_output=True, text=True).stdout.strip()
    return (REPO / common).resolve().parent.parent / name


# the tools find the compiler and the ROMs from these when they are not
# next to the repository (a worktree)
os.environ.setdefault("ZXBASIC", str(sibling("zxbasic")))
os.environ.setdefault("CPC_ROM_DIR", str(sibling("caprice32") / "rom"))


def cpcrun(prog: Path, model: str, defines: list[str], timeout: float, shot_dir: Path | None = None):
    cmd = [sys.executable, str(CPCRUN), str(prog), "--emu", "chips", "--model", model,
           "--org", ORG, "--timeout", str(timeout)]
    if shot_dir:
        cmd += ["--shot-dir", str(shot_dir), "--quiet"]
    for d in defines:
        cmd += ["--zxbc-arg=-D", f"--zxbc-arg={d}"]
    return subprocess.run(cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL,
                          timeout=timeout * 4 + 120)


def zxrun(prog: Path, model: str, defines: list[str], timeout: float, shot_dir: Path | None = None):
    """model: zx48 or zx128; the Spectrum builds get a 512-byte heap (the
    HUD makes small strings)."""
    cmd = [sys.executable, str(ZXRUN), str(prog), "--model", model[2:], "--timeout", str(timeout)]
    if shot_dir:
        cmd += ["--shot-dir", str(shot_dir), "--quiet"]
    for d in defines:
        cmd += ["--zxbc-arg=-D", f"--zxbc-arg={d}"]
    if shot_dir:
        cmd += ["--zxbc-arg=-H", "--zxbc-arg=512"]
    return subprocess.run(cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL,
                          timeout=timeout * 4 + 120)


def logic_test(model: str, timeout: float, prog: str = "logic"):
    label = f"{model}/{prog}"
    if model.startswith("zx"):
        proc = zxrun(HERE / f"{prog}.bas", model, [], timeout)
    else:
        proc = cpcrun(HERE / f"{prog}.bas", model, [], timeout)
    out = proc.stdout
    if proc.returncode != 0:
        return [("ERROR", label, f"cpcrun exit {proc.returncode}: {proc.stderr.strip()[-300:]}")]
    fails = re.findall(r"^FAIL.*$", out, re.M)
    passes = len(re.findall(r"^PASS", out, re.M))
    if fails:
        return [("FAIL", label, "; ".join(fails[:5]))]
    if "\nDONE" not in "\n" + out:
        return [("FAIL", label, "no DONE")]
    return [("PASS", label, f"{passes} checks")]


# name -> zxbc defines of the other screenshots (besides room00..room11)
SCENES = {
    "lit09": ["SHOT=3", "SHOT_LIT", "START_ROOM=9"],
    "lit10": ["SHOT=3", "SHOT_LIT", "START_ROOM=10"],
    "climb": ["SHOT=3", "SHOT_CLIMB", "START_ROOM=10"],
    "walk": ["SHOT=14", "SHOT_WALK", "START_ROOM=9"],
    "title": ["SHOT=1", "SHOT_TITLE"],
}


# the sound switches change no pixels: these shots must equal the golden of
# the same name (label -> (golden, defines))
SWITCHES = {
    "room09+NOMUSIC": ("room09", ["NOMUSIC"]),
    "room09+NOSFX": ("room09", ["NOSFX"]),
    "room09+NOSOUND": ("room09", ["NOSOUND"]),
}


def shot_test(model: str, name: str, timeout: float, update: bool):
    label = f"{model}/{name}"
    extra: list[str] = []
    gname = name
    if name in SWITCHES:
        gname, extra = SWITCHES[name]
        name = gname
    flag = {"464": "CPC464", "6128": "CPC6128", "zx48": "ZX48", "zx128": "ZX128"}[model]
    if name in SCENES:
        defs = SCENES[name]
    else:
        defs = ["SHOT=3", f"START_ROOM={int(name[4:])}"]
    with tempfile.TemporaryDirectory(prefix="lamp-") as tmp:
        run = zxrun if model.startswith("zx") else cpcrun
        proc = run(GAME / "main.bas", model, [flag, *defs, *extra], timeout, Path(tmp))
        if proc.returncode != 0:
            return [("ERROR", label, f"cpcrun exit {proc.returncode}: {proc.stderr.strip()[-300:]}")]
        shots = sorted(Path(tmp).glob("*.png"))
        if not shots:
            return [("ERROR", label, "took no screenshot")]
        gold = GOLDEN / model / f"{gname}.png"
        if update and extra:
            return [("PASS", label, "(no golden of its own)")]
        actual = gold.with_suffix(".actual.png")
        diff = gold.with_suffix(".diff.png")
        a = Image.open(shots[0]).convert("RGB")
        if update:
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


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--update", action="store_true")
    ap.add_argument("--model", choices=MODELS)
    ap.add_argument("-k", dest="pattern", default="", help="only tests whose label contains this")
    ap.add_argument("--timeout", type=float, default=60)
    args = ap.parse_args()
    models = [args.model] if args.model else list(MODELS)
    jobs = []
    for m in models:
        if not args.update:
            jobs.append((f"{m}/logic", lambda m=m: logic_test(m, args.timeout)))
            jobs.append((f"{m}/playthrough", lambda m=m: logic_test(m, args.timeout, "playthrough")))
        for name in [f"room{r:02d}" for r in ROOMS] + list(SCENES) + (list(SWITCHES) if m in ("464", "zx128") else []):
            jobs.append((f"{m}/{name}", lambda m=m, name=name: shot_test(m, name, args.timeout, args.update)))
    jobs = [j for j in jobs if args.pattern in j[0]]
    bad = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for results in ex.map(lambda j: j[1](), jobs):
            for status, label, msg in results:
                print(f"{status:7} {label} {msg}".rstrip(), flush=True)
                if status in ("FAIL", "ERROR"):
                    bad += 1
    print(f"{len(jobs)} tests, {bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
