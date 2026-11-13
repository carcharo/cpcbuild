#!/usr/bin/env python3
"""run.py -- the stress and load programs on the chips-based headless runner.

These programs run for minutes of CPC time (seconds of real time on chips) and are not part of the
conformance suite or of `make ci`: `make test-stress` runs them. Each is compiled with cpcbas and run
with tools/cpcrun.py --emu chips on the 6128 and the 464 (or --model). A program passes when the run
reaches its END marker, it prints DONE and it prints no line that starts with FAIL (isr_stress and
gamemode_stress check themselves; gamemode_load, music_load and sound_load measure the interrupt load
and print it as INFO lines, so for them the run ending cleanly is the check).

The shared helpers (chk.bas, fhlib.bas) and the song softhard.bas come from the cpcbas checkout's
tests/conformance (lib/ and assets/music/): $CPCBAS, else the sibling ../cpcbas.

Usage: run.py [-k PATTERN] [--model 464|6128] [-j N] [--timeout S] [file.bas ...]
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
CPCRUN = HERE.parent.parent / "tools" / "cpcrun.py"
CPCBAS = Path(os.environ["CPCBAS"]) if os.environ.get("CPCBAS") else HERE.parent.parent.parent / "cpcbas"
SHARED = CPCBAS.resolve() / "tests" / "conformance"
INCLUDES = [str(SHARED / "lib"), str(SHARED / "assets" / "music")]
MODELS = ("6128", "464")
TIMEOUT = 1000.0  # seconds of CPC time: the longest (isr_stress, gamemode_stress) need about 200


def run_one(bas: Path, model: str, timeout: float) -> tuple[str, str, str]:
    label = f"{model}/{bas.stem}"
    cmd = [sys.executable, str(CPCRUN), str(bas), "--emu", "chips", "--model", model, "--timeout", str(timeout)]
    for d in INCLUDES:
        cmd += ["--cpcbas-arg=-I", f"--cpcbas-arg={d}"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout + 300)
    except subprocess.TimeoutExpired:
        return ("FAIL", label, "the runner did not return")
    out = proc.stdout
    if proc.returncode != 0:
        return ("FAIL", label, f"cpcrun exit {proc.returncode}: {proc.stderr.strip()[-300:]}")
    fails = [ln for ln in out.splitlines() if ln.startswith("FAIL")]
    if fails:
        return ("FAIL", label, "; ".join(fails[:3]))
    if not re.search(r"^DONE\s*$", out, re.MULTILINE):
        return ("FAIL", label, "no DONE line")
    return ("PASS", label, "")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("-k", dest="pattern", default=None, help="only programs whose name contains PATTERN")
    ap.add_argument("--model", choices=MODELS, action="append", help="only this model (repeatable; default 6128 and 464)")
    ap.add_argument("-j", dest="jobs", type=int, default=4)
    ap.add_argument("--timeout", type=float, default=TIMEOUT)
    args = ap.parse_args()

    files = [f.resolve() for f in args.files] or sorted(HERE.glob("*.bas"))
    if args.pattern:
        files = [f for f in files if args.pattern in f.name]
    if not files:
        print("run.py: no stress programs found", file=sys.stderr)
        return 1
    jobs = [(f, m) for f in files for m in (args.model or MODELS)]
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        results = list(pool.map(lambda j: run_one(j[0], j[1], args.timeout), jobs))
    for status, name, detail in sorted(results, key=lambda r: r[1]):
        print(f"{status:6} {name}" + (f"  ({detail})" if detail else ""))
    bad = sum(1 for s, _, _ in results if s != "PASS")
    print(f"\n{len(results) - bad}/{len(results)} ok, {bad} failed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
