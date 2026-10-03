#!/usr/bin/env python3
"""run.py -- run every tests/conformance/*.bas program via cpcrun.py (in
parallel) and summarise.

A program passes if: cpcrun exited 0 (reached its `rst 0`, i.e. no
timeout/build error), it printed "DONE", and it printed no "FAIL" line.
Each conformance program prints one line per check ("PASS name" or
"FAIL name got=... want=..." -- see any tests/conformance/*.bas for the
convention) and ends with "DONE" if every check ran.

A program may mark itself expected-to-fail with a `REM XFAIL: <reason>`
line anywhere in the source (e.g. the float test, until the float
calculator port lands) -- such a program is reported separately and
does not count against the pass total.

Usage: run.py [--timeout SECONDS] [-k PATTERN] [--model M] [--emu cap32|chips] [--org ADDR] [file.bas ...]
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


def run_one(bas_path: Path, timeout: float, model: str = "6128", emu: str = "cap32", org: str | None = None) -> Result:
    result = Result(bas_path)
    result.xfail_reason = find_xfail(bas_path)
    cmd = [sys.executable, str(CPCRUN), str(bas_path), "--timeout", str(timeout), "--model", model, "--emu", emu]
    if org:
        cmd += ["--org", org]
    for text in find_typed(bas_path):
        cmd += ["--type", text]
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
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", type=Path, help="specific .bas files (default: all in this directory)")
    parser.add_argument("--timeout", type=float, default=180.0)
    parser.add_argument("-k", dest="pattern", default=None, help="only run files whose name contains PATTERN")
    parser.add_argument("-j", dest="jobs", type=int, default=8, help="parallel jobs (default 8)")
    parser.add_argument("--model", choices=("464", "664", "6128"), default="6128", help="CPC model (default 6128)")
    parser.add_argument("--emu", choices=("cap32", "chips"), default="cap32", help="emulator (default cap32)")
    parser.add_argument("--org", default=None, metavar="ADDR", help="build every program at this origin (e.g. 0x40); default: the compiler's")
    args = parser.parse_args(argv)

    files = args.files or sorted(CONFORMANCE_DIR.glob("*.bas"))
    if args.pattern:
        files = [f for f in files if args.pattern in f.name]
    if not files:
        print("run.py: no conformance .bas files found", file=sys.stderr)
        return 1

    results: list[Result] = []
    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(run_one, f, args.timeout, args.model, args.emu, args.org): f for f in files}
        for fut in as_completed(futures):
            results.append(fut.result())

    results.sort(key=lambda r: r.path.name)

    n_pass = n_fail = n_timeout = n_builderr = n_xfail = n_xpass = 0
    for r in results:
        print(f"{r.status:8} {r.path.name}")
        if r.status == "PASS":
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

    total = len(results)
    print(
        f"\n{n_pass}/{total} passed, {n_fail} failed, {n_timeout} timed out, "
        f"{n_builderr} build errors, {n_xfail} expected failures, {n_xpass} unexpected passes"
    )

    return 0 if (n_fail == 0 and n_timeout == 0 and n_builderr == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
