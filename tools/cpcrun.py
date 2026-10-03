#!/usr/bin/env python3
"""cpcrun.py -- compile, package and run a Boriel BASIC program for
--arch cpc, headlessly, and print whatever it sent to the (virtual)
printer.

    cpcrun.py prog.bas [--timeout SECONDS] [--zxbc-arg ARG] [--expect FILE]
                       [--emu cap32|chips] [--model 464|6128]
                      [--shot F.png [--shot-at N]] [--shot-dir D]   (chips only)

--emu chips runs the same program in the floooh/chips-based tools/chipsrun
(built on demand; AMSDOS-headered .bin quickloaded, no DSK).

Pipeline:
  1. Compile prog.bas with the zxbasic fork's zxbc (`poetry run zxbc` in
     the zxbasic checkout, or $ZXBASIC/... if that env var is set),
     always with `--arch cpc -D __CPC_PRINTER_ECHO__ -I <repo>/lib` (so
     `#include <music/music.bas>` works) plus any extra
     `--zxbc-arg` values.
  2. Pack the resulting .bin into an AMSDOS .dsk with the fork's
     tools/cpc/mkdsk.py.
  3. Run Caprice32 headlessly (SDL_VIDEODRIVER=dummy; $CAP32, default
     ../caprice32/cap32 relative to this repo) with the virtual printer
     enabled and pointed at a private temp file, autocommanding
     `run"<prog>"`, then CAP32_WAITBREAK (every compiled program reaches
     address 0 sooner or later: a clean END, a runtime error (error.asm
     also resets), or a crash that happens to land on `rst 0` all end up
     there; CAP32_WAITBREAK sets a breakpoint on it and holds off the
     rest of the autocmd queue until it's hit), then CAP32_EXIT.
  4. Print whatever text landed in the virtual printer file, with the
     END marker line (see below) stripped out.

Uses a private, generated cap32 config (`-c` to the real cap32.cfg next
to the cap32 binary, so ROM/resource paths still resolve, plus `-O`
overrides for the printer and its output file) -- the user's cap32.cfg
on disk is never touched. Each run gets its own temp directory, so
concurrent invocations (e.g. from tests/conformance/run.py) don't
collide.

The END marker: reaching address 0 is not proof the program reached
END -- a crash that happens to reset the machine, or an uncaught
runtime error, lands there too. zxbasic's .core.__CPC_END (bootstrap.asm,
forced into every build) sends a line containing only "\x04END" to the
printer, through the firmware gate, immediately before its own `rst 0`
-- but only under -D __CPC_PRINTER_ECHO__, the flag this script always
compiles with. So exit 0 below means the marker was actually seen, not
just that address 0 was reached.

Exit status:
  0  cap32 hit the address-0 breakpoint before the timeout *and* the
     END marker was seen in the printer transcript -- a clean END.
  1  zxbc failed to compile prog.bas (its stderr is forwarded).
  2  timeout: cap32 was killed without ever hitting the breakpoint --
     a hang, e.g. an unimplemented stub (stub.asm's __CPC_NOT_IMPLEMENTED).
  4  cap32 hit the address-0 breakpoint before the timeout, but the END
     marker was *not* seen -- a crash/reset, or an uncaught runtime
     error (error.asm's __ERROR also resets after printing "Error n");
     stderr reports whether an "Error N" line was captured to help tell
     those two apart.
  3  only with --expect: the run itself exited 0, but the captured
     printer text didn't match the expected file (a diff is printed to
     stderr).
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

REPO_ROOT = Path(__file__).resolve().parent.parent  # cpcbuild/
DEFAULT_ZXBASIC = REPO_ROOT.parent / "zxbasic"
DEFAULT_CAP32 = REPO_ROOT.parent / "caprice32" / "cap32"

# Sent by .core.__CPC_END (zxbasic's src/lib/arch/cpc/runtime/bootstrap.asm)
# right before its `rst 0`, under -D __CPC_PRINTER_ECHO__ only -- see the
# module docstring. \x04 (ASCII EOT) as the first byte keeps this line from
# ever colliding with ordinary PRINT output or with the "NOT IMPLEMENTED" /
# "Error n" text the same transcript can otherwise contain.
END_MARKER = "\x04END\n"

# error.asm's __ERROR prints "Error " followed by the decimal code with no
# leading zeros (__PRINT_DECIMAL_A) -- used only to annotate exit code 4,
# not to change it (a captured "Error N" and a bare crash/reset are both
# reported the same way: no END marker).
ERROR_LINE_RE = re.compile(r"^Error \d+$", re.MULTILINE)


def zxbasic_dir() -> Path:
    env = os.environ.get("ZXBASIC")
    return Path(env).resolve() if env else DEFAULT_ZXBASIC


def cap32_bin() -> Path:
    env = os.environ.get("CAP32")
    return Path(env).resolve() if env else DEFAULT_CAP32


def subprocess_env() -> dict[str, str]:
    """Environment for subprocesses: make sure poetry (~/.local/bin) is on
    PATH even if the caller's shell profile wasn't sourced (see both
    repos' CLAUDE.md: `export PATH=$HOME/.local/bin:$PATH`)."""
    env = os.environ.copy()
    local_bin = str(Path.home() / ".local" / "bin")
    parts = env.get("PATH", "").split(os.pathsep)
    if local_bin not in parts:
        env["PATH"] = os.pathsep.join([local_bin, *parts])
    return env


def amsdos_stem(bas_path: Path) -> str:
    """8.3-safe, upper-case AMSDOS stem for the compiled binary -- matches
    tools/cpc/run.sh's own truncation, and the run" command must name the
    same file mkdsk.py wrote.

    Restricted to [A-Z0-9]: Caprice32's autocmd keystroke injection
    (InputMapper::StringToEvents / SDLkeysFromChars, src/keyboard.cpp)
    has no entry for at least '_' (probably other punctuation too) for
    the configured keyboard layout -- indexing that std::map with an
    unmapped char silently inserts a bogus {0,0} keycode instead of
    erroring, so `run"NAME_WITH_UNDERSCORE` gets mistyped, AMSDOS never
    finds the file, and the machine just sits at the Ready prompt --
    indistinguishable from a genuine hang until CAP32_WAITBREAK's
    breakpoint times out. Found via tests/conformance/data_read.bas
    (renamed dataread.bas to sidestep it); confirmed with a byte-identical
    binary under two AMSDOS names, one with '_' (hangs) and one without
    (runs) -- so the compiled program was never the problem.
    """
    safe = "".join(ch for ch in bas_path.stem.upper() if ch.isalnum())
    return safe[:8] or "PROG"


def compile_program(bas_path: Path, out_bin: Path, extra_zxbc_args: list[str], env: dict[str, str]) -> None:
    zxdir = zxbasic_dir()
    cmd = [
        "poetry",
        "run",
        "zxbc",
        "--arch",
        "cpc",
        "-D",
        "__CPC_PRINTER_ECHO__",
        "-I",
        str(REPO_ROOT / "lib"),
        "-o",
        str(out_bin),
        str(bas_path),
        *extra_zxbc_args,
    ]
    proc = subprocess.run(cmd, cwd=zxdir, env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        raise BuildError(f"zxbc exited {proc.returncode}")


def pack_dsk(bin_path: Path, dsk_path: Path, stem: str, env: dict[str, str]) -> None:
    mkdsk = zxbasic_dir() / "tools" / "cpc" / "mkdsk.py"
    cmd = [
        sys.executable,
        str(mkdsk),
        "-o",
        str(dsk_path),
        "--load",
        "0x1000",
        "--exec",
        "0x1000",
        "--name",
        f"{stem}.BIN",
        str(bin_path),
    ]
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.stderr.write(proc.stdout)
        sys.stderr.write(proc.stderr)
        raise BuildError(f"mkdsk.py exited {proc.returncode}")


class BuildError(Exception):
    pass


CHIPSRUN_DIR = REPO_ROOT / "tools" / "chipsrun"
CHIPSRUN_BIN = CHIPSRUN_DIR / "chipsrun"


def chipsrun_bin() -> Path:
    """Path to the chipsrun binary, built on demand."""
    if not CHIPSRUN_BIN.exists():
        build = CHIPSRUN_DIR / "build.sh"
        proc = subprocess.run([str(build)], capture_output=True, text=True)
        if proc.returncode != 0 or not CHIPSRUN_BIN.exists():
            sys.stderr.write(proc.stdout + proc.stderr)
            raise BuildError(f"chipsrun not built; run {build} (needs a C compiler and network for fetch_chips.sh)")
    return CHIPSRUN_BIN


def amsdos_bin(bin_path: Path, stem: str) -> bytes:
    """The compiled .bin with its 128-byte AMSDOS header (load/exec 0x1000),
    built with the fork's mkdsk.py."""
    sys.path.insert(0, str(zxbasic_dir() / "tools" / "cpc"))
    try:
        import mkdsk  # type: ignore
    finally:
        sys.path.pop(0)
    data = bin_path.read_bytes()
    return mkdsk.build_amsdos_header(f"{stem}.BIN", data, load_addr=0x1000, exec_addr=0x1000) + data


class TimeoutHit(Exception):
    pass


# Caprice32's system.model numbers. The 464 has no disc interface built in;
# rom.slot07 gives it the DDI-1's AMSDOS ROM (cap32's DEFAULT slot07 means
# "AMSDOS unless the model is a 464"), which is how real 464 disc users run.
MODELS = {"464": 0, "664": 1, "6128": 2}


def run_emulator(
    dsk_path: Path,
    stem: str,
    printer_out: Path,
    timeout: float,
    env: dict[str, str],
    model: str = "6128",
    typed: list[str] | None = None,
) -> None:
    cap32 = cap32_bin()
    if not cap32.exists():
        raise BuildError(f"cap32 not found at {cap32} (set CAP32=/path/to/cap32)")

    cfg = cap32.parent / "cap32.cfg"
    cmd = [str(cap32)]
    if cfg.exists():
        cmd += ["-c", str(cfg)]
    cmd += [
        "-O",
        "system.printer=1",
        "-O",
        f"file.printer_file={printer_out}",
        "-O",
        "sound.enabled=0",
        "-O",
        f"system.model={MODELS[model]}",
        "-O",
        "rom.slot07=amsdos.rom",
        "-a",
        f'run"{stem}',
    ]
    # Keystrokes for the running program (--type). Each waits for
    # CAP32_DELAY (cap32's boot_time, about a second) so the program is
    # already waiting for it -- four times for the first, which also waits
    # out loading and the bootstrap's key-buffer flush -- then types the
    # text and RETURN (cap32 ends every -a with RETURN). They must come
    # before CAP32_WAITBREAK, which holds back the rest of the queue until
    # address 0 is reached, so a test that types keys should PAUSE a
    # little before its END.
    for i, text in enumerate(typed or []):
        cmd += ["-a", "CAP32_DELAY" * (4 if i == 0 else 1) + text]
    cmd += [
        "-a",
        "CAP32_WAITBREAK",
        "-a",
        "CAP32_EXIT",
        str(dsk_path),
    ]

    run_env = dict(env)
    run_env["SDL_VIDEODRIVER"] = "dummy"

    try:
        subprocess.run(cmd, env=run_env, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        # subprocess.run() already killed the child on timeout; nothing
        # is left running. See the module docstring: no breakpoint hit.
        raise TimeoutHit() from None


def run_chips(
    amsdos_path: Path,
    timeout: float,
    model: str,
    typed: list[str] | None,
    shot: Path | None = None,
    shot_dir: Path | None = None,
    shot_at: int | None = None,
) -> tuple[int, str]:
    """Run chipsrun; returns (exit code, transcript with END marker stripped)."""
    if model not in ("464", "6128"):
        raise BuildError(f"chips has no {model}")
    cmd = [str(chipsrun_bin()), "--model", model, "--rom-dir", os.environ.get("CPC_ROM_DIR") or str(REPO_ROOT.parent / "caprice32" / "rom"),
           "--timeout", str(timeout)]
    for text in typed or []:
        cmd += ["--type", text]
    if shot:
        cmd += ["--shot", str(shot)]
    if shot_at is not None:
        cmd += ["--shot-at", str(shot_at)]
    if shot_dir:
        cmd += ["--shot-dir", str(shot_dir)]
    cmd.append(str(amsdos_path))
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout * 4 + 60)
    sys.stderr.write(proc.stderr.decode("latin-1"))
    return proc.returncode, proc.stdout.decode("latin-1")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("program", type=Path, help="prog.bas to compile and run")
    parser.add_argument("--timeout", type=float, default=15.0, help="seconds before giving up (default 15)")
    parser.add_argument(
        "--zxbc-arg",
        dest="zxbc_args",
        action="append",
        default=[],
        metavar="ARG",
        help="extra argument to pass to zxbc (repeatable, e.g. --zxbc-arg --enable-break)",
    )
    parser.add_argument("--expect", type=Path, default=None, help="diff captured printer text against this file")
    parser.add_argument("--quiet", action="store_true", help="don't print the captured printer text to stdout")
    parser.add_argument("--model", choices=sorted(MODELS), default="6128", help="CPC model to emulate (default 6128)")
    parser.add_argument(
        "--emu",
        choices=("cap32", "chips"),
        default="cap32",
        help="emulator: Caprice32 (default) or the floooh/chips-based tools/chipsrun",
    )
    parser.add_argument(
        "--type",
        dest="typed",
        action="append",
        default=[],
        metavar="TEXT",
        help="keys to type while the program runs, then RETURN (repeatable; each after a delay)",
    )
    parser.add_argument("--shot", type=Path, default=None, metavar="FILE.png",
                        help="--emu chips: save the screen (768x272 RGB PNG) when the run ends")
    parser.add_argument("--shot-at", type=int, default=None, metavar="FRAMES",
                        help="--emu chips: with --shot, save it FRAMES frames after program start instead")
    parser.add_argument("--shot-dir", type=Path, default=None, metavar="DIR",
                        help="--emu chips: directory for shots the program triggers itself (see tests/screens/lib/shot.bas)")
    args = parser.parse_args(argv)
    if (args.shot or args.shot_dir or args.shot_at is not None) and args.emu != "chips":
        parser.error("--shot/--shot-at/--shot-dir need --emu chips")

    bas_path = args.program.resolve()
    if not bas_path.exists():
        parser.error(f"{bas_path}: not found")

    env = subprocess_env()
    tmpdir = Path(tempfile.mkdtemp(prefix="cpcrun-"))
    try:
        bin_path = tmpdir / "prog.bin"
        dsk_path = tmpdir / "prog.dsk"
        printer_out = tmpdir / "printer.dat"
        stem = amsdos_stem(bas_path)

        try:
            compile_program(bas_path, bin_path, args.zxbc_args, env)
        except BuildError as exc:
            print(f"cpcrun.py: build error: {exc}", file=sys.stderr)
            return 1

        exit_code = 0
        if args.emu == "chips":
            if args.model == "664":
                print("cpcrun.py: chips has no 664", file=sys.stderr)
                return 1
            amsdos_path = tmpdir / "prog.amsdos"
            amsdos_path.write_bytes(amsdos_bin(bin_path, stem))
            try:
                code, text = run_chips(amsdos_path, args.timeout, args.model, args.typed,
                                       args.shot, args.shot_dir, args.shot_at)
            except BuildError as exc:
                print(f"cpcrun.py: {exc}", file=sys.stderr)
                return 1
            except subprocess.TimeoutExpired:
                code, text = 2, ""
            if code == 1:
                return 1
            if code == 2:
                print(f"cpcrun.py: timeout after {args.timeout}s (hang -- unimplemented stub?)", file=sys.stderr)
                exit_code = 2
            elif code == 4:
                error_match = ERROR_LINE_RE.search(text)
                if error_match:
                    print(
                        f"cpcrun.py: reached address 0 without the END marker "
                        f"(runtime error captured: {error_match.group(0)!r})",
                        file=sys.stderr,
                    )
                else:
                    print(
                        "cpcrun.py: reached address 0 without the END marker "
                        "(crash/reset, or an error before any output -- no "
                        "'Error N' line captured)",
                        file=sys.stderr,
                    )
                exit_code = 4
            if not args.quiet:
                sys.stdout.write(text)
            if exit_code == 0 and args.expect is not None:
                expected = args.expect.read_text()
                if text != expected:
                    diff = difflib.unified_diff(
                        expected.splitlines(keepends=True),
                        text.splitlines(keepends=True),
                        fromfile=str(args.expect),
                        tofile="<captured>",
                    )
                    sys.stderr.writelines(diff)
                    return 3
            return exit_code

        pack_dsk(bin_path, dsk_path, stem, env)

        try:
            run_emulator(dsk_path, stem, printer_out, args.timeout, env, args.model, args.typed)
        except TimeoutHit:
            print(f"cpcrun.py: timeout after {args.timeout}s (hang -- unimplemented stub?)", file=sys.stderr)
            exit_code = 2
        except BuildError as exc:
            print(f"cpcrun.py: {exc}", file=sys.stderr)
            return 1

        captured = printer_out.read_bytes() if printer_out.exists() else b""
        text = captured.decode("latin-1")

        # exit_code == 0 here means "cap32 hit the address-0 breakpoint",
        # which is also true of a crash/reset or a runtime error (see the
        # module docstring) -- only the END marker actually proves a clean
        # END. Strip it from the reported transcript either way: it's an
        # implementation detail of this harness, not part of the program's
        # output.
        if exit_code == 0:
            if END_MARKER in text:
                text = text.replace(END_MARKER, "", 1)
            else:
                error_match = ERROR_LINE_RE.search(text)
                if error_match:
                    print(
                        f"cpcrun.py: reached address 0 without the END marker "
                        f"(runtime error captured: {error_match.group(0)!r})",
                        file=sys.stderr,
                    )
                else:
                    print(
                        "cpcrun.py: reached address 0 without the END marker "
                        "(crash/reset, or an error before any output -- no "
                        "'Error N' line captured)",
                        file=sys.stderr,
                    )
                exit_code = 4

        if not args.quiet:
            sys.stdout.write(text)

        if exit_code == 0 and args.expect is not None:
            expected = args.expect.read_text()
            if text != expected:
                diff = difflib.unified_diff(
                    expected.splitlines(keepends=True),
                    text.splitlines(keepends=True),
                    fromfile=str(args.expect),
                    tofile="<captured>",
                )
                sys.stderr.writelines(diff)
                return 3

        return exit_code
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
