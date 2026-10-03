#!/usr/bin/env python3
"""zxrun.py -- compile and run a Boriel BASIC program for --arch zx48k,
headlessly on a ZX Spectrum 48K or 128K (tools/chipsrun/zxrun), and print
the transcript the program wrote to the test port (see
tests/zx/lib/zxtest.bas).

    zxrun.py prog.bas [--model 48|128] [--timeout SECONDS] [--zxbc-arg ARG]
                      [--type TEXT]... [--expect FILE] [--quiet]
                      [--shot F.png [--shot-at N]] [--shot-dir D]

Pipeline: `poetry run zxbc --arch zx48k -f bin` in the zxbasic checkout
($ZXBASIC, default ../zxbasic), with `-I <repo>/lib -I <repo>/tests/zx/lib`
(so `#include <zxtest.bas>` and the cpcbuild library resolve) plus any
--zxbc-arg values; then zxrun loads the raw .bin at its ORG (32768, or
whatever --org / -S was passed through --zxbc-arg) on the real ROMs (fetched
by tools/chipsrun/fetch_zxroms.sh), and runs it.

Exit status (the same as cpcrun.py):
  0  the END marker was seen (TEND())
  1  zxbc failed (stderr forwarded), or a usage/setup error
  2  timeout (a hang)
  4  the program fell to address 0 or raised a runtime error (RST 8; "Error N"
     is then in the transcript) without the END marker
  3  only with --expect: the transcript differed from the file
"""
from __future__ import annotations

import argparse
import difflib
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ZXBASIC = REPO_ROOT.parent / "zxbasic"
CHIPSRUN_DIR = REPO_ROOT / "tools" / "chipsrun"
ZXRUN_BIN = CHIPSRUN_DIR / "zxrun"
ROM_DIR = CHIPSRUN_DIR / "zxroms"
ERROR_LINE_RE = re.compile(r"^Error \d+$", re.MULTILINE)


class BuildError(Exception):
    pass


def zxbasic_dir() -> Path:
    env = os.environ.get("ZXBASIC")
    return Path(env).resolve() if env else DEFAULT_ZXBASIC


def subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    local_bin = str(Path.home() / ".local" / "bin")
    parts = env.get("PATH", "").split(os.pathsep)
    if local_bin not in parts:
        env["PATH"] = os.pathsep.join([local_bin, *parts])
    return env


def org_from_args(zxbc_args: list[str]) -> int:
    """The ORG zxbc will use (-S / --org, default 32768)."""
    org = 32768
    for i, a in enumerate(zxbc_args):
        if a in ("-S", "--org") and i + 1 < len(zxbc_args):
            org = int(zxbc_args[i + 1], 0)
        elif a.startswith("--org="):
            org = int(a[6:], 0)
        elif a.startswith("-S") and len(a) > 2:
            org = int(a[2:], 0)
    return org


def compile_program(bas: Path, out_bin: Path, extra: list[str], env: dict[str, str]) -> None:
    cmd = ["poetry", "run", "zxbc", "--arch", "zx48k", "-f", "bin",
           "-I", f"{REPO_ROOT / 'lib'}:{REPO_ROOT / 'tests' / 'zx' / 'lib'}",  # zxbc keeps only the last -I; ':' separates paths
           "-o", str(out_bin), str(bas), *extra]
    proc = subprocess.run(cmd, cwd=zxbasic_dir(), env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        raise BuildError(f"zxbc exited {proc.returncode}")


def zxrun_bin() -> Path:
    """Path to zxrun, built (and the ROMs fetched) on demand."""
    if not ZXRUN_BIN.exists() or not (ROM_DIR / "48.rom").exists():
        build = CHIPSRUN_DIR / "build.sh"
        proc = subprocess.run([str(build)], capture_output=True, text=True)
        if proc.returncode != 0 or not ZXRUN_BIN.exists() or not (ROM_DIR / "48.rom").exists():
            sys.stderr.write(proc.stdout + proc.stderr)
            raise BuildError(f"zxrun not built / ROMs missing; run {build} (needs a C compiler and network)")
    return ZXRUN_BIN


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("program", type=Path)
    ap.add_argument("--model", choices=("48", "128"), default="48", help="Spectrum model (default 48)")
    ap.add_argument("--timeout", type=float, default=15.0, help="emulated seconds before giving up (default 15)")
    ap.add_argument("--zxbc-arg", dest="zxbc_args", action="append", default=[], metavar="ARG",
                    help="extra zxbc argument (repeatable)")
    ap.add_argument("--expect", type=Path, default=None, help="diff the transcript against this file")
    ap.add_argument("--quiet", action="store_true", help="don't print the transcript")
    ap.add_argument("--type", dest="typed", action="append", default=[], metavar="TEXT",
                    help="keys to type while the program runs, then ENTER (repeatable)")
    ap.add_argument("--shot", type=Path, default=None, metavar="FILE.png", help="save the screen (320x256) when the run ends")
    ap.add_argument("--shot-at", type=int, default=None, metavar="FRAMES", help="with --shot: save it FRAMES frames after start instead")
    ap.add_argument("--shot-dir", type=Path, default=None, metavar="DIR", help="directory for shots the program triggers (TSHOT)")
    args = ap.parse_args(argv)

    bas = args.program.resolve()
    if not bas.exists():
        ap.error(f"{bas}: not found")
    env = subprocess_env()
    tmp = Path(tempfile.mkdtemp(prefix="zxrun-"))
    try:
        out_bin = tmp / "prog.bin"
        try:
            compile_program(bas, out_bin, args.zxbc_args, env)
            exe = zxrun_bin()
        except BuildError as exc:
            print(f"zxrun.py: {exc}", file=sys.stderr)
            return 1
        cmd = [str(exe), "--model", args.model, "--rom-dir", str(ROM_DIR), "--timeout", str(args.timeout),
               "--org", str(org_from_args(args.zxbc_args))]
        for t in args.typed:
            cmd += ["--type", t]
        if args.shot:
            cmd += ["--shot", str(args.shot)]
        if args.shot_at is not None:
            cmd += ["--shot-at", str(args.shot_at)]
        if args.shot_dir:
            cmd += ["--shot-dir", str(args.shot_dir)]
        cmd.append(str(out_bin))
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=args.timeout * 4 + 60)
            code, text = proc.returncode, proc.stdout.decode("latin-1")
            sys.stderr.write(proc.stderr.decode("latin-1"))
        except subprocess.TimeoutExpired:
            code, text = 2, ""
        if code == 1:
            return 1
        rc = 0
        if code == 2:
            print(f"zxrun.py: timeout after {args.timeout}s (hang)", file=sys.stderr)
            rc = 2
        elif code == 4:
            m = ERROR_LINE_RE.search(text)
            if m:
                print(f"zxrun.py: runtime error without the END marker ({m.group(0)!r})", file=sys.stderr)
            else:
                print("zxrun.py: reached address 0 without the END marker (crash/reset)", file=sys.stderr)
            rc = 4
        elif code != 0:
            print(f"zxrun.py: zxrun exited {code}", file=sys.stderr)
            return 1
        if not args.quiet:
            sys.stdout.write(text)
        if rc == 0 and args.expect is not None:
            expected = args.expect.read_text()
            if text != expected:
                sys.stderr.writelines(difflib.unified_diff(expected.splitlines(keepends=True), text.splitlines(keepends=True),
                                                           fromfile=str(args.expect), tofile="<captured>"))
                return 3
        return rc
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
