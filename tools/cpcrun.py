#!/usr/bin/env python3
"""cpcrun.py -- compile, package and run a Boriel BASIC program for
--arch cpc, headlessly, and print whatever it sent to the (virtual)
printer.

    cpcrun.py prog.bas [--org ADDR] [--timeout SECONDS] [--zxbc-arg ARG] [--expect FILE]
                       [--emu cap32|chips|cpcec] [--model 464|664|6128|plus]
                      [--shot F.png [--shot-at N]] [--shot-dir D]   (chips only)
                      [--bare] [--cold]
                      [--disk-file NAME=PATH ...]                   (Caprice32 only)
    cpcrun.py --cpr FILE.cpr [--model plus] [--timeout S] [--type TEXT ...]   (Caprice32 only)

--disk-file NAME=PATH puts PATH on the DSK as the AMSDOS file NAME (8.3, upper
case; an AMSDOS header is added: binary, load address &4000, no entry), next
to the program, so the program can read it (e.g. with BankLoad). Repeatable.
chips has no disc, so --emu chips refuses it.

--model plus (Caprice32 only, Phase 7): a 6128 Plus (Caprice32 model 3) with the
system cartridge (rom/system.cpr). After reset it shows the cartridge's
"f1 Amstrad BASIC / f2 Burnin' Rubber" menu; the run presses F1 (autocmd
CPC_F1, after Caprice32's boot_time, which is pinned to 42 frames for this
model), waits a CAP32_DELAY and types run"<prog> as on the other models. The
Plus's printer port is the same &EFxx and is captured the same way, the END
marker and exit codes are unchanged. --emu chips --model plus is an error.

--emu cpcec (Phase 7) runs CPCEC (tools/cpcec, built by fetch_build.sh with our
small patch; $CPCEC overrides the path). It is headless (SDL dummy drivers, no
window or sound, no real-time delays), supports every model, draws the Plus
sprites per scanline (Caprice32 does it once per frame), and honours the same
contracts: the printer capture and the END marker (the run ends 3 frames after
it), exit codes 0/1/2/4, --timeout (which is also CPC time: TIMEOUT*50 frames;
a hang is exit 2). --type is not supported. Discs: CPCEC autoruns the .dsk
itself (it picks the program, here the only file; on the Plus it presses F1 in
the cartridge menu). --shot-dir works as for chips: Shot("name") in a program
saves <shot-dir>/name.png (CPCEC's own screen grab, 768x536 RGB; no SHOT_HOLD,
the program goes on, any number of shots); --shot F.png [--shot-at FRAMES]
saves the screen when the run ends (or at that frame). CPCEC's colours differ
from Caprice32's by design, so its screenshots have their own goldens
(tests/screens/golden/cpcec-plus). --cpr works too.

--cpr FILE.cpr runs a prebuilt cartridge instead of a program (no compile, no
DSK): Caprice32 (or CPCEC) loads it in place of the system cartridge, so there is no
firmware and the cartridge starts at reset (a GX4000-style boot); implies
--model plus. Printer capture and END detection are as for a program (the
cartridge's END marker, then `rst 0` back into the cartridge: the run stops at
the first address-0 hit after the autocmd queue reaches CAP32_WAITBREAK, and
everything from the first END marker on is dropped, so a restarting cartridge
doesn't matter).

--shot FILE.png with --model plus (Caprice32 screenshot, 768x540 RGB PNG: the
CPC picture, 2x, with the border): compiles with `-D SHOT_HOLD` so that
tests/screens/lib/shot.bas Shot("name") holds the screen after the
`\x04SHOT name` printer line instead of going on; the run waits --shot-wait
CAP32_DELAYs (42 frames each, default 8), presses CAP32_SCRNSHOT and exits, and the
PNG Caprice32 wrote is moved to FILE.png. Without a SHOT line the run fails
(exit 5). The shot name is printed to stderr as `shot: NAME`.

--bare adds `-D CPC_BAREMETAL` to the compile (bare-metal runtime, Phase 6).
--cold (chips only) rehearses a no-firmware boot, e.g. a GX4000-style
cartridge: chipsrun does not run the firmware at all; it fills RAM with a junk
pattern, puts the image at its load address with both ROMs paged out, and
starts the CPU at the entry with interrupts off. The program must set up
everything itself, so it only makes sense with --bare (a firmware-mode
program would call into a ROM that isn't there). See chipsrun.c's header for
the exact power-on state.
A --bare run ends, like a firmware-mode one, at the reset to address 0 after
the END marker; --end-on-marker ends it as soon as the marker line has been
captured instead (chipsrun --end-on-marker; on Caprice32 the printer file is
polled), for debugging a runtime whose reset misbehaves. The "\x04STATE" lines of
tests/conformance/lib/bareout.bas BState() are removed from cap32 transcripts
too (chipsrun consumes them itself).

The program's origin: --org ADDR (e.g. 0x40) is passed to zxbc as --org; with
no --org zxbc uses its own default. Either way the AMSDOS header (load and
exec address) and the DSK file use the origin zxbc actually compiled for,
read back from the memory map it writes (-M, `.core.__START_PROGRAM`), so the
two can never disagree -- even with `--zxbc-arg=--org=...`.

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
  5  only with --model plus --shot: no screenshot was produced.
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
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent  # cpcbuild/
DEFAULT_ZXBASIC = REPO_ROOT.parent / "zxbasic"
DEFAULT_CAP32 = REPO_ROOT.parent / "caprice32" / "cap32"
DEFAULT_CPCEC = REPO_ROOT / "tools" / "cpcec" / "work" / "cpcec"

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


def cpcec_bin() -> Path:
    env = os.environ.get("CPCEC")
    return Path(env).resolve() if env else DEFAULT_CPCEC


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


def read_origin(map_path: Path) -> int:
    """The origin zxbc compiled for: the address of .core.__START_PROGRAM
    in its memory map (-M), the first byte of the .bin and its entry point."""
    for line in map_path.read_text().splitlines():
        addr, _, label = line.partition(":")
        if label.strip() == ".core.__START_PROGRAM":
            return int(addr, 16)
    raise BuildError(f"no .core.__START_PROGRAM in {map_path}; cannot tell the program's origin")


def compile_program(bas_path: Path, out_bin: Path, extra_zxbc_args: list[str], env: dict[str, str]) -> int:
    """Compile; returns the origin zxbc used (see read_origin)."""
    zxdir = zxbasic_dir()
    map_path = out_bin.with_suffix(".map")
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
        "-M",
        str(map_path),
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
    return read_origin(map_path)


def pack_dsk(bin_path: Path, dsk_path: Path, stem: str, env: dict[str, str], org: int,
             extra_files: list[tuple[str, Path]] | None = None) -> None:
    if extra_files:
        # mkdsk.py's command line gives every input the same name rules and
        # load address, so use its DiskImage directly: the program first,
        # then each data file under its own name.
        sys.path.insert(0, str(zxbasic_dir() / "tools" / "cpc"))
        try:
            import mkdsk  # type: ignore
        finally:
            sys.path.pop(0)
        disk = mkdsk.DiskImage()
        disk.add_file(f"{stem}.BIN", bin_path.read_bytes(), load_addr=org, exec_addr=org)
        for name, path in extra_files:
            disk.add_file(name, path.read_bytes(), load_addr=0x4000, exec_addr=0)
        dsk_path.write_bytes(disk.to_dsk_bytes())
        return
    mkdsk = zxbasic_dir() / "tools" / "cpc" / "mkdsk.py"
    cmd = [
        sys.executable,
        str(mkdsk),
        "-o",
        str(dsk_path),
        "--load",
        f"0x{org:04X}",
        "--exec",
        f"0x{org:04X}",
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


def amsdos_bin(bin_path: Path, stem: str, org: int) -> bytes:
    """The compiled .bin with its 128-byte AMSDOS header (load/exec = org),
    built with the fork's mkdsk.py."""
    sys.path.insert(0, str(zxbasic_dir() / "tools" / "cpc"))
    try:
        import mkdsk  # type: ignore
    finally:
        sys.path.pop(0)
    data = bin_path.read_bytes()
    return mkdsk.build_amsdos_header(f"{stem}.BIN", data, load_addr=org, exec_addr=org) + data


class TimeoutHit(Exception):
    pass


# CPCEC's -mN machine numbers (464, 664, 6128, 6128 Plus)
CPCEC_MODELS = {"464": 0, "664": 1, "6128": 2, "plus": 3}


def run_cpcec(
    file_path: Path,
    printer_out: Path,
    timeout: float,
    env: dict[str, str],
    model: str,
    shot: Path | None = None,
    shot_dir: Path | None = None,
    shot_at: int | None = None,
) -> None:
    """Run CPCEC (our patched build, see tools/cpcec/cpcbuild.patch) headlessly on
    a .dsk or .cpr, printer into printer_out. It quits 3 frames after the END
    marker; TimeoutHit if it gets to TIMEOUT*50 emulated frames first (CPCEC
    exits 3) or the wall clock (4x TIMEOUT: it runs far faster than real time)
    is up."""
    cpcec = cpcec_bin()
    if not cpcec.exists():
        raise BuildError(f"cpcec not found at {cpcec} (run sh tools/cpcec/fetch_build.sh, or set CPCEC=/path/to/cpcec)")
    cmd = [str(cpcec), "--headless", "--end-on-marker", "--printer", str(printer_out),
           "--max-frames", str(int(timeout * 50)), f"-m{CPCEC_MODELS[model]}"]
    if file_path.suffix.lower() == ".dsk":
        cmd.append("-x")  # discs on, the 464 included
    if model in ("464", "664"):
        cmd.append("-k0")  # a stock 464/664 has 64 KB (the 6128 and Plus 128 KB)
    if shot_dir:
        cmd += ["--shot-dir", str(shot_dir)]
    if shot:
        cmd += ["--shot", str(shot)]
        if shot_at is not None:
            cmd += ["--shot-at", str(shot_at)]
    cmd.append(str(file_path))
    try:
        proc = subprocess.run(cmd, env=env, capture_output=True, timeout=timeout * 4 + 10)
    except subprocess.TimeoutExpired:
        raise TimeoutHit() from None
    if proc.returncode == 3:
        raise TimeoutHit()
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr.decode("latin-1"))
        raise BuildError(f"cpcec exited {proc.returncode}")


# Caprice32's system.model numbers. The 464 has no disc interface built in;
# rom.slot07 gives it the DDI-1's AMSDOS ROM (cap32's DEFAULT slot07 means
# "AMSDOS unless the model is a 464"), which is how real 464 disc users run.
MODELS = {"464": 0, "664": 1, "6128": 2, "plus": 3}

# Caprice32 video settings that would otherwise vary from one user's cap32.cfg
# to the next (or from run to run: the fps counter) and so change the pixels of
# a screenshot. Only used for screenshot runs.
SHOT_OVERRIDES = {
    "video.scr_scale": "2",
    "video.scr_style": "1",
    "video.scr_fps": "0",
    "video.scr_led": "0",
    "video.scr_tube": "0",
    "video.scr_intensity": "10",
    "video.scr_remanency": "0",
}

# Frames CAP32_DELAY waits for (cap32's boot_time). Fixed so Plus timing doesn't
# depend on the local cap32.cfg.
PLUS_BOOT_TIME = 42


def run_emulator(
    dsk_path: Path | None,
    stem: str,
    printer_out: Path,
    timeout: float,
    env: dict[str, str],
    model: str = "6128",
    typed: list[str] | None = None,
    end_on_marker: bool = False,
    cpr_path: Path | None = None,
    shot_dir: Path | None = None,
    shot_wait: int = 0,
) -> None:
    """Run Caprice32 headlessly. dsk_path (a program on a disc) or cpr_path (a
    cartridge, Plus only) is what runs. With shot_dir the run is a screenshot
    run: it takes one screenshot into shot_dir after shot_wait CAP32_DELAYs
    and exits (no WAITBREAK: the program holds its screen)."""
    cap32 = cap32_bin()
    if not cap32.exists():
        raise BuildError(f"cap32 not found at {cap32} (set CAP32=/path/to/cap32)")

    # the user's cap32.cfg if there is one (git-ignored in caprice32). A fresh
    # build (CI) has only cap32.cfg.tmpl, whose __SHARE_PATH__ placeholders we
    # fill in with the cap32 directory (ROMs are in its rom/), in a private copy
    cfg = cap32.parent / "cap32.cfg"
    tmpl = cap32.parent / "cap32.cfg.tmpl"
    if not cfg.exists() and tmpl.exists():
        cfg = printer_out.parent / "cap32.cfg"
        cfg.write_text(tmpl.read_text().replace("__SHARE_PATH__", str(cap32.parent)))
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
        # a stock 464 or 664 has 64 KB; Caprice32's default (128) would give
        # them a RAM expansion, which the bank library would then (rightly) use
        "-O",
        f"system.ram_size={64 if model in ('464', '664') else 128}",
    ]
    if model != "plus":
        cmd += ["-O", "rom.slot07=amsdos.rom"]
    else:
        cmd += ["-O", f"system.boot_time={PLUS_BOOT_TIME}"]
    if shot_dir is not None:
        cmd += ["-O", f"file.sdump_dir={shot_dir}"]
        for key, val in SHOT_OVERRIDES.items():
            cmd += ["-O", f"{key}={val}"]
    if model == "plus" and cpr_path is None:
        # the system cartridge's menu: f1 Amstrad BASIC, f2 Burnin' Rubber
        # (needs the cartridge's own delay: CAP32_DELAY note in cap32.cpp)
        cmd += ["-a", "CPC_F1", "-a", "CAP32_DELAY"]
    if cpr_path is None:
        cmd += ["-a", f'run"{stem}']
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
    if shot_dir is not None:
        # hold-and-shoot: wait, one screenshot, wait a frame or two, exit
        cmd += ["-a", "CAP32_DELAY" * shot_wait + "CAP32_SCRNSHOT", "-a", "CAP32_DELAY"]
    else:
        cmd += ["-a", "CAP32_WAITBREAK"]
    cmd += ["-a", "CAP32_EXIT", str(cpr_path or dsk_path)]

    run_env = dict(env)
    run_env["SDL_VIDEODRIVER"] = "dummy"
    # Caprice32 runs at 50 fps (limit_speed) unless told otherwise; the
    # emulation is frame-driven, so the Plus runs go flat out
    if model == "plus":
        cmd[1:1] = ["-O", "system.limit_speed=0"]

    if end_on_marker:
        # --end-on-marker: stop as soon as the END marker is in the printer
        # file, instead of waiting for the address-0 breakpoint.
        proc = subprocess.Popen(cmd, env=run_env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + timeout
        marker = END_MARKER.encode("latin-1")
        try:
            while proc.poll() is None:
                if time.monotonic() > deadline:
                    raise TimeoutHit()
                time.sleep(0.2)
                if printer_out.exists() and marker in printer_out.read_bytes():
                    time.sleep(0.3)
                    return
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
        return
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
    cold: bool = False,
    end_on_marker: bool = False,
) -> tuple[int, str]:
    """Run chipsrun; returns (exit code, transcript with END marker stripped)."""
    if model not in ("464", "6128"):
        raise BuildError(f"chips has no {model}")
    cmd = [str(chipsrun_bin()), "--model", model, "--rom-dir", os.environ.get("CPC_ROM_DIR") or str(REPO_ROOT.parent / "caprice32" / "rom"),
           "--timeout", str(timeout)]
    if cold:
        cmd.append("--cold")
    if end_on_marker:
        cmd.append("--end-on-marker")
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
    parser.add_argument("program", type=Path, nargs="?", help="prog.bas to compile and run (not with --cpr)")
    parser.add_argument("--cpr", type=Path, default=None, metavar="FILE.cpr",
                        help="run this prebuilt cartridge instead of a program (Caprice32, Plus; no firmware)")
    parser.add_argument("--shot-wait", type=int, default=8, metavar="N",
                        help="--model plus --shot: CAP32_DELAYs (42 frames each) to wait before the screenshot (default 8)")
    parser.add_argument("--timeout", type=float, default=15.0, help="seconds before giving up (default 15)")
    parser.add_argument(
        "--zxbc-arg",
        dest="zxbc_args",
        action="append",
        default=[],
        metavar="ARG",
        help="extra argument to pass to zxbc (repeatable, e.g. --zxbc-arg --enable-break)",
    )
    parser.add_argument("--org", default=None, metavar="ADDR",
                        help="program origin passed to zxbc (e.g. 0x40); the AMSDOS header and DSK follow what zxbc used")
    parser.add_argument("--expect", type=Path, default=None, help="diff captured printer text against this file")
    parser.add_argument("--quiet", action="store_true", help="don't print the captured printer text to stdout")
    parser.add_argument("--model", choices=sorted(MODELS), default=None,
                        help="CPC model to emulate (default 6128; plus with --cpr). plus = 6128 Plus, Caprice32 only")
    parser.add_argument(
        "--emu",
        choices=("cap32", "chips", "cpcec"),
        default="cap32",
        help="emulator: Caprice32 (default), the floooh/chips-based tools/chipsrun, or CPCEC (tools/cpcec)",
    )
    parser.add_argument(
        "--type",
        dest="typed",
        action="append",
        default=[],
        metavar="TEXT",
        help="keys to type while the program runs, then RETURN (repeatable; each after a delay)",
    )
    parser.add_argument("--disk-file", dest="disk_files", action="append", default=[], metavar="NAME=PATH",
                        help="put PATH on the DSK as AMSDOS file NAME (repeatable; Caprice32 only, chips has no disc)")
    parser.add_argument("--bare", action="store_true", help="compile with -D CPC_BAREMETAL (bare-metal runtime)")
    parser.add_argument("--cold", action="store_true",
                        help="--emu chips: cold start, no firmware (junk RAM, ROMs out, jump to the entry); implies a bare build is expected")
    parser.add_argument("--end-on-marker", action="store_true",
                        help="end the run when the END marker line is captured, without waiting for the reset to address 0")
    parser.add_argument("--shot", type=Path, default=None, metavar="FILE.png",
                        help="--emu chips: save the screen (768x272 RGB PNG) when the run ends; "
                             "--model plus: hold at the program's Shot() and save the Caprice32 screenshot (768x540)")
    parser.add_argument("--shot-at", type=int, default=None, metavar="FRAMES",
                        help="--emu chips: with --shot, save it FRAMES frames after program start instead")
    parser.add_argument("--shot-dir", type=Path, default=None, metavar="DIR",
                        help="--emu chips: directory for shots the program triggers itself (see tests/screens/lib/shot.bas)")
    args = parser.parse_args(argv)
    if args.model is None:
        args.model = "plus" if args.cpr else "6128"
    if args.model == "plus" and args.emu == "chips":
        parser.error("chips has no Plus: --model plus needs --emu cap32")
    if args.cpr:
        if args.program:
            parser.error("--cpr runs a cartridge: no program to compile")
        if args.model != "plus" or args.emu not in ("cap32", "cpcec"):
            parser.error("--cpr needs --model plus and --emu cap32 or cpcec")
        if not args.cpr.is_file():
            parser.error(f"{args.cpr}: not found")
        if args.bare or args.zxbc_args or args.org or args.disk_files:
            parser.error("--cpr takes no compile options or disk files")
    elif not args.program:
        parser.error("a program (or --cpr FILE.cpr) is required")
    plus_shot = args.model == "plus" and args.shot is not None and args.emu == "cap32"
    if (args.shot_dir or args.shot_at is not None) and args.emu == "cap32":
        parser.error("--shot-at/--shot-dir need --emu chips or cpcec")
    if args.shot and args.emu == "cap32" and not plus_shot:
        parser.error("--shot needs --emu chips or cpcec, or --model plus")
    if args.emu == "cpcec" and (args.typed or args.cold):
        parser.error("--emu cpcec has no --type or --cold")
    if plus_shot and args.cpr:
        parser.error("--shot with --cpr is not supported")
    if args.cold and args.emu != "chips":
        parser.error("--cold needs --emu chips")
    if args.cold and not args.bare:
        parser.error("--cold needs --bare (a firmware-mode program cannot start without the firmware)")
    if args.bare:
        args.zxbc_args = ["-D", "CPC_BAREMETAL", *args.zxbc_args]
        if args.cold and args.model == "464":
            # a cold start can't see the 464 firmware's jumpblock; the 464 draws
            # its lines a little differently from the 6128 (gfxbare.asm)
            args.zxbc_args = ["-D", "CPC_LINE_464", *args.zxbc_args]

    extra_files: list[tuple[str, Path]] = []
    for spec in args.disk_files:
        name, sep, path = spec.partition("=")
        if not sep or not name or not path or not Path(path).is_file():
            parser.error(f"--disk-file {spec!r}: want NAME=PATH with an existing PATH")
        extra_files.append((name.upper(), Path(path).resolve()))
    if extra_files and args.emu == "chips":
        parser.error("--disk-file needs --emu cap32 (chips has no disc)")

    bas_path = args.program.resolve() if args.program else None
    if bas_path is not None and not bas_path.exists():
        parser.error(f"{bas_path}: not found")
    if plus_shot:
        args.zxbc_args = ["-D", "SHOT_HOLD", *args.zxbc_args]

    if args.org is not None:
        args.zxbc_args = ["--org", args.org, *args.zxbc_args]

    env = subprocess_env()
    tmpdir = Path(tempfile.mkdtemp(prefix="cpcrun-"))
    try:
        bin_path = tmpdir / "prog.bin"
        dsk_path = tmpdir / "prog.dsk"
        printer_out = tmpdir / "printer.dat"
        shot_tmp = tmpdir / "shots"
        stem = amsdos_stem(bas_path) if bas_path else ""

        org = 0
        if bas_path is not None:
            try:
                org = compile_program(bas_path, bin_path, args.zxbc_args, env)
            except BuildError as exc:
                print(f"cpcrun.py: build error: {exc}", file=sys.stderr)
                return 1

        exit_code = 0
        if args.emu == "chips":
            if args.model == "664":
                print("cpcrun.py: chips has no 664", file=sys.stderr)
                return 1
            amsdos_path = tmpdir / "prog.amsdos"
            amsdos_path.write_bytes(amsdos_bin(bin_path, stem, org))
            try:
                code, text = run_chips(amsdos_path, args.timeout, args.model, args.typed,
                                       args.shot, args.shot_dir, args.shot_at, args.cold,
                                       args.end_on_marker)
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

        if bas_path is not None:
            pack_dsk(bin_path, dsk_path, stem, env, org, extra_files)
        if plus_shot:
            shot_tmp.mkdir()
        if args.emu == "cpcec" and args.shot_dir:
            args.shot_dir.mkdir(parents=True, exist_ok=True)

        try:
            if args.emu == "cpcec":
                run_cpcec(args.cpr.resolve() if args.cpr else dsk_path, printer_out, args.timeout, env, args.model,
                          args.shot, args.shot_dir, args.shot_at)
            else:
                run_emulator(dsk_path if bas_path else None, stem, printer_out, args.timeout, env, args.model,
                             args.typed, args.end_on_marker, args.cpr.resolve() if args.cpr else None,
                             shot_tmp if plus_shot else None, args.shot_wait)
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
        text = text.replace("\x04STATE\n", "")
        if args.emu == "cpcec":
            text = re.sub(r"\x04SHOT \S+\n", "", text)  # the harness's own lines, like chips
        if plus_shot and exit_code == 0:
            # a screenshot run never reaches address 0 (the program holds its
            # screen at Shot()): success is the SHOT line plus the PNG
            m = re.search(r"\x04SHOT (\S+)\n", text)
            pngs = sorted(shot_tmp.glob("*.png"))
            if not m or len(pngs) != 1:
                print(f"cpcrun.py: no screenshot (SHOT line {'seen' if m else 'missing'}, "
                      f"{len(pngs)} PNG files)", file=sys.stderr)
                return 5
            args.shot.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(pngs[0]), str(args.shot))
            print(f"shot: {m.group(1)}", file=sys.stderr)
            if not args.quiet:
                sys.stdout.write(re.sub(r"\x04SHOT \S+\n", "", text))
            return 0
        if exit_code == 0:
            if END_MARKER in text:
                # The marker is the program's last output. Caprice32 runs a few
                # instructions after the address-0 breakpoint (RAM at 0, not the
                # ROM), and that can print junk after it, so drop everything
                # from the marker on.
                text = text.split(END_MARKER, 1)[0]
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
