#!/usr/bin/env python3
"""run.py -- golden-screenshot tests on the chips-based headless runner.

For every tests/screens/*.bas (or the files/-k pattern given), for each
model (464 and 6128 unless --model), compile the program, run it with
tools/cpcrun.py --emu chips and collect the screenshots it asked for (see
lib/shot.bas: Shot("name") makes the runner save <name>.png), then compare
each pixel for pixel with golden/<model>/<name>.png.

A shot is the visible display, 768x272 RGB (see tools/chipsrun/chipsrun.c).

--model plus (Phase 7) runs on Caprice32 instead (chips has no Plus): cpcrun.py
--model plus --shot holds the program at its Shot() and takes a Caprice32
screenshot (768x540 RGB, the CPC picture doubled, with border; Shot() in
lib/shot.bas stops the program there under -D SHOT_HOLD, so one shot per
program). Goldens are golden/plus/, separate from chips' (different renderer).
Plus is not in the default model set: ask for it with --model plus (the
Makefile's test-plus does).

A test file may say, in REM lines:
  REM SOURCE: path     compile that file (relative to the test) instead
  REM ZXBC: args       extra zxbc arguments (one REM ZXBC: line per
                       argument group, split on spaces; repeatable)
  REM BARE: skip why   not run with --bare (needs the firmware)

  --bare     build with -D CPC_BAREMETAL and compare against the same
             (firmware-mode) goldens: bare output must be pixel-identical
  --cold     with --bare: chips cold start (no firmware ever runs)

  --update   write the shots as the new goldens (and report what changed)
On a mismatch the actual image and a diff image (differing pixels in red
over a dimmed copy of the actual shot) are written next to the golden as
<name>.actual.png and <name>.diff.png, and the number of differing pixels
is reported. Exit status 0 if every shot matched.

Usage: run.py [--update] [--model 464|6128|plus] [-k PATTERN] [-j N] [--timeout S] [file.bas ...]
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
ALL_MODELS = (*MODELS, "plus")

SOURCE_RE = re.compile(r"^\s*REM\s+SOURCE:\s*(\S.*?)\s*$", re.IGNORECASE)
ZXBC_RE = re.compile(r"^\s*REM\s+ZXBC:\s*(\S.*?)\s*$", re.IGNORECASE)
BARE_SKIP_RE = re.compile(r"^\s*REM\s+BARE:\s*skip\b", re.IGNORECASE)


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


def bare_skip(bas: Path) -> bool:
    return any(BARE_SKIP_RE.match(line) for line in bas.read_text(encoding="latin-1").splitlines())


def run_test(bas: Path, model: str, timeout: float, update: bool, org: str | None = None,
             bare: bool = False, cold: bool = False) -> list[tuple[str, str, str]]:
    """Returns [(status, "<model>/<test>:<shot>", detail)], status one of
    PASS, FAIL, NEW (golden written/updated), UPDATED, ERROR."""
    label = f"{model}/{bas.stem}"
    if bare and bare_skip(bas):
        return [("SKIP", label, "REM BARE: skip")]
    source, zargs = spec(bas)
    with tempfile.TemporaryDirectory(prefix="screens-") as tmp:
        if model == "plus":
            # Caprice32: one shot per program, file named by us; the shot's own
            # name comes back on stderr ("shot: NAME")
            cmd = [sys.executable, str(CPCRUN), str(source), "--model", "plus",
                   "--timeout", str(timeout), "--quiet", "--shot", str(Path(tmp) / "plus-shot.png")]
        else:
            cmd = [sys.executable, str(CPCRUN), str(source), "--emu", "chips", "--model", model,
                   "--timeout", str(timeout), "--quiet", "--shot-dir", tmp]
        if org:
            cmd += ["--org", org]
        if bare:
            cmd.append("--bare")
        if cold:
            cmd.append("--cold")
        for a in zargs:
            cmd.append(f"--zxbc-arg={a}")
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout * 4 + 120)
        if proc.returncode != 0:
            return [("ERROR", label, f"cpcrun exit {proc.returncode}: {proc.stderr.strip()[-300:]}")]
        if model == "plus":
            m = re.search(r"^shot: (\S+)$", proc.stderr, re.MULTILINE)
            if m and (Path(tmp) / "plus-shot.png").exists():
                (Path(tmp) / "plus-shot.png").rename(Path(tmp) / f"{m.group(1)}.png")
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
    ap.add_argument("--model", choices=ALL_MODELS, action="append", help="only this model (repeatable; default 464 and 6128 on chips; plus = Caprice32)")
    ap.add_argument("-k", dest="pattern", default=None, help="only tests whose name contains PATTERN")
    ap.add_argument("-j", dest="jobs", type=int, default=8)
    ap.add_argument("--timeout", type=float, default=60.0)
    ap.add_argument("--org", default=None, metavar="ADDR", help="build at this origin (e.g. 0x40); goldens are origin-independent")
    ap.add_argument("--bare", action="store_true", help="build with -D CPC_BAREMETAL; compare against the same goldens")
    ap.add_argument("--cold", action="store_true", help="chips cold start, no firmware (implies --bare)")
    args = ap.parse_args()
    if args.cold:
        args.bare = True
    if args.cold and "plus" in (args.model or ()):
        ap.error("--cold is chips only")
    if args.bare and args.update:
        ap.error("goldens come from firmware-mode runs: --update can't be combined with --bare")

    files = [f.resolve() for f in args.files] or sorted(HERE.glob("*.bas"))
    if args.pattern:
        files = [f for f in files if args.pattern in f.name]
    if not files:
        print("run.py: no screen tests found", file=sys.stderr)
        return 1
    jobs = [(f, m) for f in files for m in (args.model or MODELS)]
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda j: run_test(j[0], j[1], args.timeout, args.update, args.org, args.bare, args.cold), jobs))
    flat = sorted((r for rs in results for r in rs), key=lambda r: r[1])
    for status, name, detail in flat:
        print(f"{status:8} {name}" + (f"  ({detail})" if detail else ""))
    bad = sum(1 for s, _, _ in flat if s in ("FAIL", "ERROR"))
    skipped = sum(1 for s, _, _ in flat if s == "SKIP")
    print(f"\n{len(flat) - bad - skipped}/{len(flat) - skipped} ok, {bad} failed" + (f", {skipped} skipped" if skipped else ""))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
