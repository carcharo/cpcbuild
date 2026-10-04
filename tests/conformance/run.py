#!/usr/bin/env python3
"""run.py -- run every tests/conformance/*.bas program via cpcrun.py (in
parallel) and summarise.

A program passes if: cpcrun exited 0 (reached its `rst 0`, i.e. no
timeout/build error), it printed "DONE", and it printed no "FAIL" line.
Each conformance program prints one line per check ("PASS name" or
"FAIL name got=... want=..." -- see any tests/conformance/*.bas for the
convention) and ends with "DONE" if every check ran.

A program may restrict where it runs with header lines (anywhere in the source):
`REM MODELS: 6128` (only on those models, space separated: 464 664 6128 plus),
`REM EMUS: cap32` (only on that emulator: e.g. a test that needs a disc),
`REM ZXBC: -D NAME` (extra compiler arguments, space separated), and
ask for data files on the disc (Caprice32): `REM DISKFILE: NAME.BIN=path`, the
path relative to this directory. Other combinations are reported as SKIP and
not counted. A test without MODELS runs on every model including plus; one that
lists models but not plus does not run on plus.

--model plus (Phase 7): a 6128 Plus on Caprice32 (cpcrun.py --model plus: system
cartridge, F1 menu, firmware or --bare) or on CPCEC (--emu cpcec, headless;
tests that type keys are skipped there); chips has no Plus.

Bare-metal mode (Phase 6): --bare compiles every program with -D CPC_BAREMETAL
(tools/cpcrun.py --bare); --cold (chips only, implies --bare) also starts it
from a no-firmware cold start (chipsrun --cold). Two header lines say how a
test relates to it:
`REM BARE: skip <reason>` -- the test can never work bare (firmware-only
features: disc, firmware sound/key buffer/clock, direct firmware calls);
reported as SKIP under --bare/--cold, run normally otherwise.
`REM BARE: only` -- a bare-specific test (it can't use PRINT/CHK: see
lib/bareout.bas); reported as SKIP in a normal run.
`REM STATE: key=value ...` (chips only) -- after the run, compare the state
the program asked chipsrun to dump (lib/bareout.bas BState(), see chipsrun.c
for the keys) with these key=value pairs; a difference is a FAIL.

A program may mark itself expected-to-fail with a `REM XFAIL: <reason>`
line anywhere in the source (e.g. the float test, until the float
calculator port lands) -- such a program is reported separately and
does not count against the pass total.

Usage: run.py [--timeout SECONDS] [-k PATTERN] [--model M] [--emu cap32|chips|cpcec] [--org ADDR] [--bare] [--cold] [file.bas ...]
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

CONFORMANCE_DIR = Path(__file__).resolve().parent
CPCRUN = CONFORMANCE_DIR.parent.parent / "tools" / "cpcrun.py"

XFAIL_RE = re.compile(r"^\s*REM\s+XFAIL:\s*(.*)$", re.IGNORECASE)
MODELS_RE = re.compile(r"^\s*REM\s+MODELS:\s*(.*?)\s*$", re.IGNORECASE)
EMUS_RE = re.compile(r"^\s*REM\s+EMUS:\s*(.*?)\s*$", re.IGNORECASE)
ZXBC_RE = re.compile(r"^\s*REM\s+ZXBC:\s*(.*?)\s*$", re.IGNORECASE)
DISKFILE_RE = re.compile(r"^\s*REM\s+DISKFILE:\s*(\S+)\s*$", re.IGNORECASE)
BARE_RE = re.compile(r"^\s*REM\s+BARE:\s*(\w+)\b\s*(.*?)\s*$", re.IGNORECASE)
STATE_RE = re.compile(r"^\s*REM\s+STATE:\s*(.*?)\s*$", re.IGNORECASE)
STATE_OUT_RE = re.compile(r"^chipsrun-state: (.*)$", re.MULTILINE)
TYPE_RE = re.compile(r"^\s*REM\s+TYPE:\s*(\S*)\s*$", re.IGNORECASE)
FAIL_LINE_RE = re.compile(r"^FAIL\b.*$", re.MULTILINE)


class Result:
    def __init__(self, path: Path):
        self.path = path
        self.xfail_reason: str | None = None
        self.exit_code: int | None = None
        self.output: str = ""
        self.stderr: str = ""
        self.timed_out = False
        self.skipped = False

    @property
    def fail_lines(self) -> list[str]:
        return FAIL_LINE_RE.findall(self.output)

    @property
    def reached_done(self) -> bool:
        return "\nDONE" in ("\n" + self.output)

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and self.reached_done and not self.fail_lines

    @property
    def status(self) -> str:
        if self.skipped:
            return "SKIP"
        if self.ok:
            return "XPASS" if self.xfail_reason else "PASS"
        if self.xfail_reason:
            return "XFAIL"
        if self.exit_code == 2:
            return "TIMEOUT"
        if self.exit_code == 1:
            return "BUILDERR"
        return "FAIL"


def find_xfail(bas_path: Path) -> str | None:
    for line in bas_path.read_text().splitlines():
        m = XFAIL_RE.match(line)
        if m:
            return m.group(1).strip()
    return None


def find_typed(bas_path: Path) -> list[str]:
    """Keystrokes a test wants typed while it runs: one per `REM TYPE:
    text` line, in order (cpcrun.py --type, which adds RETURN)."""
    typed = []
    for line in bas_path.read_text().splitlines():
        m = TYPE_RE.match(line)
        if m:
            typed.append(m.group(1))
    return typed


def find_directive(bas_path: Path, regex: re.Pattern) -> list[str]:
    """The (stripped) argument of every header line matching regex."""
    return [m.group(1) for m in map(regex.match, bas_path.read_text().splitlines()) if m]


def bare_directive(bas_path: Path) -> tuple[str | None, str]:
    """(`skip` | `only` | None, reason) from the `REM BARE:` line, if any."""
    for line in bas_path.read_text().splitlines():
        m = BARE_RE.match(line)
        if m:
            return m.group(1).lower(), m.group(2)
    return None, ""


def check_state(result: Result, bas_path: Path) -> None:
    """Compare chipsrun's state dump with the `REM STATE:` pairs; add FAIL
    lines to the output for any difference."""
    want = [tok for line in find_directive(bas_path, STATE_RE) for tok in line.split()]
    if not want:
        return
    m = STATE_OUT_RE.search(result.stderr)
    if not m:
        result.output += "FAIL state_missing (no chipsrun-state line)\n"
        return
    got = dict(tok.partition("=")[::2] for tok in m.group(1).split())
    for tok in want:
        key, _, val = tok.partition("=")
        if got.get(key) != val:
            result.output += f"FAIL state_{key} got={got.get(key)} want={val}\n"
        else:
            result.output += f"PASS state_{key}\n"


def run_one(bas_path: Path, timeout: float, model: str = "6128", emu: str = "cap32", org: str | None = None,
            bare: bool = False, cold: bool = False, end_on_marker: bool = False) -> Result:
    result = Result(bas_path)
    result.xfail_reason = find_xfail(bas_path)
    kind, _reason = bare_directive(bas_path)
    if (bare and kind == "skip") or (not bare and kind == "only"):
        result.skipped = True
        return result
    models = [m for line in find_directive(bas_path, MODELS_RE) for m in line.split()]
    emus = [e for line in find_directive(bas_path, EMUS_RE) for e in line.split()]
    if (models and model not in models) or (emus and emu not in emus):
        result.skipped = True
        return result
    if emu == "cpcec" and find_typed(bas_path):
        result.skipped = True  # cpcrun --emu cpcec cannot type keys
        return result
    cmd = [sys.executable, str(CPCRUN), str(bas_path), "--timeout", str(timeout), "--model", model, "--emu", emu]
    if org:
        cmd += ["--org", org]
    if bare:
        cmd.append("--bare")
    if cold:
        cmd.append("--cold")
    if end_on_marker:
        cmd.append("--end-on-marker")
    for line in find_directive(bas_path, ZXBC_RE):
        for arg in line.split():
            cmd.append(f"--zxbc-arg={arg}")
    for text in find_typed(bas_path):
        cmd += ["--type", text]
    for spec in find_directive(bas_path, DISKFILE_RE):
        name, _, path = spec.partition("=")
        cmd += ["--disk-file", f"{name}={CONFORMANCE_DIR / path}"]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout + 30,  # generous outer bound; cpcrun enforces its own
        )
        result.exit_code = proc.returncode
        result.output = proc.stdout
        result.stderr = proc.stderr
    except subprocess.TimeoutExpired as exc:
        result.timed_out = True
        result.exit_code = 2
        result.output = exc.stdout.decode() if exc.stdout else ""
        result.stderr = exc.stderr.decode() if exc.stderr else ""
    if emu == "chips" and result.exit_code == 0:
        check_state(result, bas_path)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", type=Path, help="specific .bas files (default: all in this directory)")
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("-k", dest="pattern", default=None, help="only run files whose name contains PATTERN")
    parser.add_argument("-j", dest="jobs", type=int, default=8, help="parallel jobs (default 8)")
    parser.add_argument("--model", choices=("464", "664", "6128", "plus"), default="6128", help="CPC model (default 6128; plus = 6128 Plus, Caprice32 only)")
    parser.add_argument("--emu", choices=("cap32", "chips", "cpcec"), default="cap32",
                        help="emulator (default cap32; cpcec = tools/cpcec, headless CPCEC: tests that type keys are skipped)")
    parser.add_argument("--org", default=None, metavar="ADDR", help="build every program at this origin (e.g. 0x40); default: the compiler's")
    parser.add_argument("--bare", action="store_true", help="build with -D CPC_BAREMETAL; skip `REM BARE: skip` tests")
    parser.add_argument("--cold", action="store_true", help="chips only: cold start with no firmware (implies --bare)")
    parser.add_argument("--end-on-marker", action="store_true", help="end each run at the END marker line, not the reset (cpcrun.py --end-on-marker)")
    args = parser.parse_args(argv)
    if args.model == "plus" and args.emu == "chips":
        parser.error("chips has no Plus: --model plus needs --emu cap32 or cpcec")
    if args.cold:
        args.bare = True
        if args.emu != "chips":
            parser.error("--cold needs --emu chips")

    files = args.files or sorted(CONFORMANCE_DIR.glob("*.bas"))
    if args.pattern:
        files = [f for f in files if args.pattern in f.name]
    if not files:
        print("run.py: no conformance .bas files found", file=sys.stderr)
        return 1

    results: list[Result] = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(run_one, f, args.timeout, args.model, args.emu, args.org, args.bare, args.cold, args.end_on_marker): f for f in files}
        for fut in as_completed(futures):
            results.append(fut.result())

    results.sort(key=lambda r: r.path.name)

    n_pass = n_fail = n_timeout = n_builderr = n_xfail = n_xpass = n_skip = 0
    for r in results:
        print(f"{r.status:8} {r.path.name}")
        if r.status == "SKIP":
            n_skip += 1
        elif r.status == "PASS":
            n_pass += 1
        elif r.status == "XFAIL":
            n_xfail += 1
            print(f"           (expected failure: {r.xfail_reason})")
        elif r.status == "XPASS":
            n_xpass += 1
            print(f"           (unexpectedly passed -- was marked XFAIL: {r.xfail_reason})")
        elif r.status == "TIMEOUT":
            n_timeout += 1
        elif r.status == "BUILDERR":
            n_builderr += 1
            for line in r.stderr.splitlines():
                print(f"           {line}")
        else:
            n_fail += 1
            for line in r.fail_lines:
                print(f"           {line}")
            if not r.reached_done:
                print("           (did not print DONE)")

    total = len(results) - n_skip
    print(
        f"\n{n_pass}/{total} passed, {n_fail} failed, {n_timeout} timed out, "
        f"{n_builderr} build errors, {n_xfail} expected failures, {n_xpass} unexpected passes"
        + (f", {n_skip} skipped (other model/emulator)" if n_skip else "")
    )

    return 0 if (n_fail == 0 and n_timeout == 0 and n_builderr == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
