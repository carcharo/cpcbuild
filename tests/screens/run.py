#!/usr/bin/env python3
"""run.py -- golden-screenshot tests on the chips-based headless runner.

For every tests/screens/*.bas (or the files/-k pattern given), for each
model (464 and 6128 unless --model), compile the program, run it with
tools/cpcrun.py --emu chips and collect the screenshots it asked for (see
lib/shot.bas: Shot("name") makes the runner save <name>.png), then compare
each pixel for pixel with golden/<model>/<name>.png.

A shot is the visible display, 768x272 RGB (see tools/chipsrun/chipsrun.c).

A test file may say, in REM lines:
  REM SOURCE: path     compile that file (relative to the test) instead
  REM ZXBC: args       extra zxbc arguments (one REM ZXBC: line per
                       argument group, split on spaces; repeatable)

  --update   write the shots as the new goldens (and report what changed)
On a mismatch the actual image and a diff image (differing pixels in red
over a dimmed copy of the actual shot) are written next to the golden as
<name>.actual.png and <name>.diff.png, and the number of differing pixels
is reported. Exit status 0 if every shot matched.

Usage: run.py [--update] [--model 464|6128] [-k PATTERN] [-j N] [--timeout S] [file.bas ...]
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

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
CPCRUN = HERE.parent.parent / "tools" / "cpcrun.py"
GOLDEN = HERE / "golden"
MODELS = ("464", "6128")

SOURCE_RE = re.compile(r"^\s*REM\s+SOURCE:\s*(\S.*?)\s*$", re.IGNORECASE)
ZXBC_RE = re.compile(r"^\s*REM\s+ZXBC:\s*(\S.*?)\s*$", re.IGNORECASE)


def spec(bas: Path) -> tuple[Path, list[str]]:
    source, args = bas, []
    for line in bas.read_text().splitlines():
        m = SOURCE_RE.match(line)
        if m:
            source = (bas.parent / m.group(1)).resolve()
        m = ZXBC_RE.match(line)
        if m:
            args += shlex.split(m.group(1))
    return source, args


def run_test(bas: Path, model: str, timeout: float, update: bool) -> list[tuple[str, str, str]]:
    """Returns [(status, "<model>/<test>:<shot>", detail)], status one of
    PASS, FAIL, NEW (golden written/updated), UPDATED, ERROR."""
    label = f"{model}/{bas.stem}"
    source, zargs = spec(bas)
    with tempfile.TemporaryDirectory(prefix="screens-") as tmp:
        cmd = [sys.executable, str(CPCRUN), str(source), "--emu", "chips", "--model", model,
               "--timeout", str(timeout), "--quiet", "--shot-dir", tmp]
        for a in zargs:
            cmd.append(f"--zxbc-arg={a}")
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout * 4 + 120)
        if proc.returncode != 0:
            return [("ERROR", label, f"cpcrun exit {proc.returncode}: {proc.stderr.strip()[-300:]}")]
        shots = sorted(Path(tmp).glob("*.png"))
        if not shots:
            return [("ERROR", label, "program took no screenshot")]
        out = []
        for shot in shots:
            name = f"{model}/{shot.stem}"
            gold = GOLDEN / model / shot.name
            actual = gold.with_suffix(".actual.png")
            diff = gold.with_suffix(".diff.png")
            if update:
                gold.parent.mkdir(parents=True, exist_ok=True)
                had = gold.exists()
                new = Image.open(shot).convert("RGB")
                changed = not had or ImageChops.difference(new, Image.open(gold).convert("RGB")).getbbox() is not None
                if changed:
                    new.save(gold, optimize=True)  # goldens are compared by pixels, so store them compressed
                out.append(("UPDATED" if changed else "PASS", name, "new" if not had else ("changed" if changed else "")))
                for f in (actual, diff):
                    f.unlink(missing_ok=True)
                continue
            if not gold.exists():
                actual.parent.mkdir(parents=True, exist_ok=True)
                actual.write_bytes(shot.read_bytes())
                out.append(("FAIL", name, f"no golden (run with --update); actual at {actual}"))
                continue
            a = Image.open(shot).convert("RGB")
            g = Image.open(gold).convert("RGB")
            if a.size != g.size:
                actual.write_bytes(shot.read_bytes())
                out.append(("FAIL", name, f"size {a.size} != golden {g.size}"))
                continue
            d = ImageChops.difference(a, g).convert("L").point(lambda v: 255 if v else 0)
            n = d.histogram()[255]
            if n == 0:
                for f in (actual, diff):
                    f.unlink(missing_ok=True)
                out.append(("PASS", name, ""))
                continue
            a.save(actual)
            dim = a.point(lambda v: v // 4)
            dim.paste(Image.new("RGB", a.size, (255, 0, 0)), mask=d)
            dim.save(diff)
            out.append(("FAIL", name, f"{n} pixels differ; see {actual.name} and {diff.name} in {gold.parent}"))
        return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--update", action="store_true", help="regenerate the golden screenshots")
    ap.add_argument("--model", choices=MODELS, action="append", help="only this model (repeatable; default both)")
    ap.add_argument("-k", dest="pattern", default=None, help="only tests whose name contains PATTERN")
    ap.add_argument("-j", dest="jobs", type=int, default=8)
    ap.add_argument("--timeout", type=float, default=60.0)
    args = ap.parse_args()

    files = [f.resolve() for f in args.files] or sorted(HERE.glob("*.bas"))
    if args.pattern:
        files = [f for f in files if args.pattern in f.name]
    if not files:
        print("run.py: no screen tests found", file=sys.stderr)
        return 1
    jobs = [(f, m) for f in files for m in (args.model or MODELS)]
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda j: run_test(j[0], j[1], args.timeout, args.update), jobs))
    flat = sorted((r for rs in results for r in rs), key=lambda r: r[1])
    for status, name, detail in flat:
        print(f"{status:8} {name}" + (f"  ({detail})" if detail else ""))
    bad = sum(1 for s, _, _ in flat if s in ("FAIL", "ERROR"))
    print(f"\n{len(flat) - bad}/{len(flat)} ok, {bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
