#!/usr/bin/env python3
"""run.py -- Starfall's CPC tests, headless on the chips emulator.

  logic.bas     the game logic tests (null layer), both models: every
                "PASS name" line, no "FAIL", and DONE.
  screenshots   the title screen (-D SHOT=60) and a gameplay frame
                (-D DEMO -D SHOT=170: the attract-mode player, fixed seed)
                of the real builds (6128: -D CPC6128, 464: -D CPC464), each
                compared pixel for pixel with golden/<model>/<name>.png.
                A shot is the visible display, 768x272 RGB (chipsrun).

  --update   write the shots as the new goldens
On a mismatch the actual image and a diff image (differing pixels in red over
a dimmed copy) are written next to the golden. Exit status 0 if all passed.

Usage: run.py [--update] [--model 464|6128] [-k PATTERN] [--timeout S]
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
CPCRUN = GAME.parent.parent / "tools" / "cpcrun.py"
GOLDEN = HERE / "golden"
MODELS = ("6128", "464")
ORG = "0x40"

# name -> extra zxbc defines
SHOTS = {
    "title": ["SHOT=60"],
    "play": ["DEMO", "SHOT=170"],
}


def cpcrun(prog: Path, model: str, defines: list[str], timeout: float, shot_dir: Path | None = None):
    cmd = [sys.executable, str(CPCRUN), str(prog), "--emu", "chips", "--model", model,
           "--org", ORG, "--timeout", str(timeout)]
    if shot_dir:
        cmd += ["--shot-dir", str(shot_dir), "--quiet"]
    if prog.name == "main.bas":
        defines = [*defines, "NODISC"]   # chips has no disc (BankLoad would hang)
    for d in defines:
        cmd += ["--zxbc-arg=-D", f"--zxbc-arg={d}"]
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout * 4 + 120)


def logic_test(model: str, timeout: float):
    label = f"{model}/logic"
    proc = cpcrun(HERE / "logic.bas", model, [], timeout)
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


def shot_test(model: str, name: str, timeout: float, update: bool):
    label = f"{model}/{name}"
    flag = "CPC464" if model == "464" else "CPC6128"
    with tempfile.TemporaryDirectory(prefix="starfall-") as tmp:
        proc = cpcrun(GAME / "main.bas", model, [flag, *SHOTS[name]], timeout, Path(tmp))
        if proc.returncode != 0:
            return [("ERROR", label, f"cpcrun exit {proc.returncode}: {proc.stderr.strip()[-300:]}")]
        shots = sorted(Path(tmp).glob("*.png"))
        if not shots:
            return [("ERROR", label, "took no screenshot")]
        shot = shots[0]
        gold = GOLDEN / model / f"{name}.png"
        actual = gold.with_suffix(".actual.png")
        diff = gold.with_suffix(".diff.png")
        a = Image.open(shot).convert("RGB")
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
    ap.add_argument("--model", choices=MODELS, action="append")
    ap.add_argument("-k", dest="pattern", default=None)
    ap.add_argument("-j", dest="jobs", type=int, default=4)
    ap.add_argument("--timeout", type=float, default=60.0)
    args = ap.parse_args()

    jobs = []
    for m in args.model or MODELS:
        if not args.update:
            jobs.append(lambda m=m: logic_test(m, args.timeout))
        for name in SHOTS:
            jobs.append(lambda m=m, name=name: shot_test(m, name, args.timeout, args.update))
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(j) for j in jobs]
        results = [r for f in futures for r in f.result()]
    results.sort(key=lambda r: r[1])
    if args.pattern:
        results = [r for r in results if args.pattern in r[1]]
    for status, name, detail in results:
        print(f"{status:8} {name}" + (f"  ({detail})" if detail else ""))
    bad = sum(1 for s, _, _ in results if s in ("FAIL", "ERROR"))
    print(f"\n{len(results) - bad}/{len(results)} ok, {bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
