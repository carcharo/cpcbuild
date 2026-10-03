#!/usr/bin/env python3
"""run.py -- Spectrum (zx48k) conformance and screenshot tests on chips.

Runs every tests/zx/*.bas through tools/zxrun.py, on 48K and 128K (both,
unless the test limits itself or --model is given), in parallel. A test
passes if zxrun exited 0 (END marker seen), the transcript has a "DONE" line
and no "FAIL" line (see tests/zx/lib/zxtest.bas: TEND, CHK), and every screenshot
it took (TSHOT) equals tests/zx/golden/<model>/<name>.png pixel for pixel
(320x256 RGB). On a mismatch <name>.actual.png and <name>.diff.png are written
next to the golden.

tests/zx/negative/*.bas are runner self-tests: they must end the way their
header says (REM EXPECT-EXIT: n, or REM EXPECT-FAIL for a clean run whose
transcript has a FAIL line). Pass --no-negative to skip them.

Header lines in a test (REM lines anywhere):
  REM MODELS: 48|128|48 128   models to run on (default both)
  REM TYPE: text              keys typed while it runs (zxrun.py --type), in order
  REM ZXBC: args              extra zxbc arguments (split on spaces; repeatable)
  REM XFAIL: reason           expected to fail (reported separately)
  REM TIMEOUT: seconds        emulated-time limit (default 20)

  --update   write the screenshots as the new goldens

Usage: run.py [--update] [--model 48|128] [-k PATTERN] [-j N] [file.bas ...]
"""
from __future__ import annotations

import argparse
import re
import shlex
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ZXRUN = HERE.parent.parent / "tools" / "zxrun.py"
GOLDEN = HERE / "golden"
ALL_MODELS = ("48", "128")

HEADER_RE = re.compile(r"^\s*REM\s+([A-Z-]+):?\s*(.*?)\s*$")
FAIL_RE = re.compile(r"^FAIL\b.*$", re.MULTILINE)


def header(bas: Path) -> dict:
    h = {"models": list(ALL_MODELS), "type": [], "zxbc": [], "xfail": None, "timeout": 20.0, "exit": None, "expect_fail": False}
    for line in bas.read_text().splitlines():
        m = HEADER_RE.match(line)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        if key == "MODELS":
            h["models"] = [x for x in val.replace(",", " ").split() if x in ALL_MODELS]
        elif key == "TYPE":
            h["type"].append(val)
        elif key == "ZXBC":
            h["zxbc"] += shlex.split(val)
        elif key == "XFAIL":
            h["xfail"] = val
        elif key == "TIMEOUT":
            h["timeout"] = float(val)
        elif key == "EXPECT-EXIT":
            h["exit"] = int(val)
        elif key == "EXPECT-FAIL" and line.lstrip().upper().startswith("REM EXPECT-FAIL"):
            h["expect_fail"] = True
    return h


def compare_shots(shots: list[Path], model: str, update: bool) -> list[str]:
    from PIL import Image, ImageChops
    problems = []
    for shot in shots:
        gold = GOLDEN / model / shot.name
        actual, diff = gold.with_suffix(".actual.png"), gold.with_suffix(".diff.png")
        new = Image.open(shot).convert("RGB")
        if update:
            gold.parent.mkdir(parents=True, exist_ok=True)
            if not gold.exists() or ImageChops.difference(new, Image.open(gold).convert("RGB")).getbbox():
                new.save(gold, optimize=True)
            for f in (actual, diff):
                f.unlink(missing_ok=True)
            continue
        if not gold.exists():
            actual.parent.mkdir(parents=True, exist_ok=True)
            new.save(actual)
            problems.append(f"shot {shot.stem}: no golden (run with --update); actual at {actual}")
            continue
        g = Image.open(gold).convert("RGB")
        if g.size != new.size:
            problems.append(f"shot {shot.stem}: size {new.size} != golden {g.size}")
            continue
        d = ImageChops.difference(new, g).convert("L").point(lambda v: 255 if v else 0)
        n = d.histogram()[255]
        if n == 0:
            for f in (actual, diff):
                f.unlink(missing_ok=True)
            continue
        new.save(actual)
        dim = new.point(lambda v: v // 4)
        dim.paste(Image.new("RGB", new.size, (255, 0, 0)), mask=d)
        dim.save(diff)
        problems.append(f"shot {shot.stem}: {n} pixels differ; see {actual.name} and {diff.name} in {gold.parent}")
    return problems


def run_one(bas: Path, model: str, update: bool, negative: bool) -> tuple[str, str, list[str]]:
    """Returns (status, label, detail lines); status PASS/FAIL/XFAIL/XPASS/UPDATED."""
    h = header(bas)
    label = f"{model}/{'negative/' if negative else ''}{bas.stem}"
    with tempfile.TemporaryDirectory(prefix="zxtests-") as tmp:
        cmd = [sys.executable, str(ZXRUN), str(bas), "--model", model, "--timeout", str(h["timeout"]), "--shot-dir", tmp]
        for t in h["type"]:
            cmd += ["--type", t]
        for a in h["zxbc"]:
            cmd.append(f"--zxbc-arg={a}")
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=h["timeout"] * 4 + 120)
        out, code = proc.stdout, proc.returncode
        detail: list[str] = []
        if negative:
            if h["expect_fail"]:
                ok = code == 0 and bool(FAIL_RE.search(out))
            else:
                ok = code == h["exit"]
            if not ok:
                detail.append(f"exit {code}, expected {'0 with a FAIL line' if h['expect_fail'] else h['exit']}")
            return ("PASS" if ok else "FAIL"), label, detail
        if code != 0:
            detail.append(f"zxrun exit {code}: {proc.stderr.strip()[-300:]}")
        else:
            detail += FAIL_RE.findall(out)
            if "\nDONE" not in "\n" + out:
                detail.append("(did not print DONE)")
            detail += compare_shots(sorted(Path(tmp).glob("*.png")), model, update)
        ok = not detail
        if h["xfail"]:
            return ("XPASS" if ok else "XFAIL"), label, [f"(marked XFAIL: {h['xfail']})"]
        return ("PASS" if ok else "FAIL"), label, detail


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--update", action="store_true", help="regenerate the golden screenshots")
    ap.add_argument("--model", choices=ALL_MODELS, action="append", help="only this model (repeatable)")
    ap.add_argument("-k", dest="pattern", default=None, help="only tests whose name contains PATTERN")
    ap.add_argument("-j", dest="jobs", type=int, default=8)
    ap.add_argument("--no-negative", action="store_true", help="skip the runner self-tests in negative/")
    args = ap.parse_args()

    jobs = []
    files = [f.resolve() for f in args.files]
    normal = files or sorted(HERE.glob("*.bas"))
    neg = [] if (files or args.no_negative) else sorted((HERE / "negative").glob("*.bas"))
    for group, is_neg in ((normal, False), (neg, True)):
        for f in group:
            if args.pattern and args.pattern not in f.name:
                continue
            for m in header(f)["models"]:
                if not args.model or m in args.model:
                    jobs.append((f, m, is_neg))
    if not jobs:
        print("run.py: no tests found", file=sys.stderr)
        return 1
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda j: run_one(j[0], j[1], args.update, j[2]), jobs))
    results.sort(key=lambda r: r[1].split("/", 1)[1] + r[1])
    for status, label, detail in results:
        print(f"{status:7} {label}")
        if status != "PASS":
            for d in detail:
                print(f"          {d}")
    bad = sum(1 for s, _, _ in results if s in ("FAIL", "XPASS"))
    print(f"\n{len(results) - bad}/{len(results)} ok, {bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
