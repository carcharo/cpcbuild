#!/usr/bin/env python3
"""bench.py -- speed comparison between Boriel BASIC (--arch cpc) and
Locomotive BASIC 1.1, both running on a real-speed, headless Caprice32
CPC 6128.

See README.md for the full method. In short:

  - Caprice32 runs at real (emulated) speed even headless, and fflushes
    its printer-capture file after every byte it receives (cap32.cpp,
    around line 770). So both the Boriel and the Locomotive program
    send a bare "S" then a bare "E" line to the printer around the
    section being timed, and this script polls the capture file every
    ~2ms, recording the host wall-clock time each marker line first
    appears. elapsed = t(E) - t(S) is real CPC time, without any of
    cap32's own overhead (compiling, disk access, keystroke injection,
    booting) polluting the measurement.

  - Boriel programs send their markers through a tiny inline ASM
    snippet that calls MC_PRINT_CHAR (&BD2B) directly through the
    firmware gate (fwcall.asm), bypassing PRINT/__PRINTCHAR (and so
    the -D __CPC_PRINTER_ECHO__ echo) entirely -- see bench/boriel/*.bas
    and README.md. Locomotive programs use PRINT#8 (stream 8 = printer).

  - Each measurement is repeated 3 times; the median and the min..max
    spread are reported.

Run: python3 bench.py   (from anywhere; paths below are relative to
this file). Requires the environment set up per cpcbuild/CLAUDE.md:
    export PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:$HOME/.local/bin:$PATH
Generated files (bench/_work, bench/micro) are not committed.
"""

from __future__ import annotations

import os
import statistics
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

BENCH_DIR = Path(__file__).resolve().parent
CPCBUILD_ROOT = BENCH_DIR.parent
ZXBASIC_DIR = CPCBUILD_ROOT.parent / "zxbasic"
CAP32_BIN = CPCBUILD_ROOT.parent / "caprice32" / "cap32"
CAP32_CFG = CAP32_BIN.parent / "cap32.cfg"
MKDSK = ZXBASIC_DIR / "tools" / "cpc" / "mkdsk.py"

BORIEL_DIR = BENCH_DIR / "boriel"
LOCO_DIR = BENCH_DIR / "locomotive"
WORK_DIR = BENCH_DIR / "_work"

POLL_INTERVAL = 0.002  # 2ms, as specified
REPEATS = 3


def env_with_path() -> dict[str, str]:
    env = os.environ.copy()
    extra = ["/opt/homebrew/opt/coreutils/libexec/gnubin", str(Path.home() / ".local" / "bin")]
    parts = env.get("PATH", "").split(os.pathsep)
    for p in reversed(extra):
        if p not in parts:
            parts.insert(0, p)
    env["PATH"] = os.pathsep.join(parts)
    return env


def kill_stray_cap32() -> None:
    subprocess.run(["pkill", "-9", "-x", "cap32"], capture_output=True)
    time.sleep(0.2)


# ---------------------------------------------------------------------
# Boriel side: compile, pack, run
# ---------------------------------------------------------------------


def compile_boriel(bas_path: Path, out_bin: Path, echo: bool, env: dict[str, str]) -> None:
    cmd = ["poetry", "run", "zxbc", "--arch", "cpc"]
    if echo:
        cmd += ["-D", "__CPC_PRINTER_ECHO__"]
    cmd += ["-o", str(out_bin), str(bas_path)]
    proc = subprocess.run(cmd, cwd=ZXBASIC_DIR, env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"zxbc failed on {bas_path.name}:\n{proc.stdout}\n{proc.stderr}")


def pack_dsk(bin_path: Path, dsk_path: Path, stem: str, env: dict[str, str]) -> None:
    cmd = [
        sys.executable,
        str(MKDSK),
        "-o",
        str(dsk_path),
        "--load",
        "0x40",
        "--exec",
        "0x40",
        "--name",
        f"{stem}.BIN",
        str(bin_path),
    ]
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"mkdsk.py failed for {dsk_path.name}:\n{proc.stdout}\n{proc.stderr}")


# ---------------------------------------------------------------------
# Shared: run cap32, poll the printer capture file for markers
# ---------------------------------------------------------------------


@dataclass
class RunResult:
    t_start: float | None = None
    t_end: float | None = None
    elapsed: float | None = None
    text: str = ""
    done: bool = False
    timed_out: bool = False

    @property
    def result_lines(self) -> list[str]:
        """Lines strictly between the E marker and the DONE sentinel.

        Found by substring search, not line-splitting: benchmark 6's
        echoed build ends its PRINT-based loop with a trailing ";" (no
        newline), so the E marker's own "E\\n" lands glued onto the end
        of the last loop-output line (e.g. "...1000 E\\n"), not on a
        line of its own. None of our benchmarks ever print a bare
        capital E elsewhere before the marker (no scientific-notation
        floats in the ranges used here), so the first "E\\n" in the
        text is always the real marker.
        """
        norm = self.text.replace("\r", "")
        done_idx = norm.find("DONE")
        head = norm[:done_idx] if done_idx != -1 else norm
        e_idx = head.find("E\n")
        if e_idx == -1:
            return []
        tail = head[e_idx + 2 :]
        return [ln for ln in tail.split("\n") if ln]


def run_cap32(autocmd: list[str], dsk_path: Path | None, timeout: float, printer_path: Path) -> RunResult:
    kill_stray_cap32()
    if printer_path.exists():
        printer_path.unlink()

    cmd = [str(CAP32_BIN)]
    if CAP32_CFG.exists():
        cmd += ["-c", str(CAP32_CFG)]
    cmd += [
        "-O",
        "system.printer=1",
        "-O",
        f"file.printer_file={printer_path}",
        "-O",
        "sound.enabled=0",
        "-O",
        "system.limit_speed=1",  # real-speed emulation -- see README.md
    ]
    for a in autocmd:
        cmd += ["-a", a]
    if dsk_path is not None:
        cmd.append(str(dsk_path))

    env = env_with_path()
    env["SDL_VIDEODRIVER"] = "dummy"

    proc = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    result = RunResult()
    accum = ""
    pos = 0
    deadline = time.perf_counter() + timeout
    try:
        while time.perf_counter() < deadline:
            data = b""
            try:
                with open(printer_path, "rb") as f:
                    f.seek(pos)
                    data = f.read()
                    pos += len(data)
            except FileNotFoundError:
                pass
            if data:
                now = time.perf_counter()
                accum += data.decode("latin-1")
                norm = accum.replace("\r", "")
                if result.t_start is None and "S\n" in norm:
                    result.t_start = now
                if result.t_end is None and "E\n" in norm:
                    result.t_end = now
                if "DONE" in norm:
                    result.done = True
                    result.text = accum
                    break
            time.sleep(POLL_INTERVAL)
        else:
            result.timed_out = True
            result.text = accum
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=3)
        kill_stray_cap32()

    if result.t_start is not None and result.t_end is not None:
        result.elapsed = result.t_end - result.t_start
    return result


# ---------------------------------------------------------------------
# Locomotive side: autotype the program, RUN it
# ---------------------------------------------------------------------


def run_locomotive(lines: list[str], timeout: float, printer_path: Path) -> RunResult:
    autocmd = list(lines) + ["RUN"]
    return run_cap32(autocmd, None, timeout, printer_path)


# ---------------------------------------------------------------------
# Boriel: compile once per (file, echo) pair, then run
# ---------------------------------------------------------------------


def build_boriel(bas_name: str, stem: str, echo: bool, env: dict[str, str]) -> Path:
    """Compile + pack once; returns the .dsk path to run (possibly several times)."""
    WORK_DIR.mkdir(exist_ok=True)
    bas_path = BORIEL_DIR / bas_name
    bin_path = WORK_DIR / f"{stem}.bin"
    dsk_path = WORK_DIR / f"{stem}.dsk"

    compile_boriel(bas_path, bin_path, echo, env)
    pack_dsk(bin_path, dsk_path, stem, env)
    return dsk_path


def run_boriel_dsk(dsk_path: Path, stem: str, timeout: float) -> RunResult:
    printer_path = WORK_DIR / f"{stem}_printer.dat"
    return run_cap32([f'run"{stem}', "CAP32_WAITBREAK", "CAP32_EXIT"], dsk_path, timeout, printer_path)


def run_boriel(bas_name: str, stem: str, echo: bool, timeout: float, env: dict[str, str]) -> RunResult:
    """Compile + pack + run once (used for ad hoc/manual testing)."""
    dsk_path = build_boriel(bas_name, stem, echo, env)
    return run_boriel_dsk(dsk_path, stem, timeout)


def read_loco_lines(name: str) -> list[str]:
    text = (LOCO_DIR / name).read_text()
    return [ln for ln in text.splitlines() if ln.strip()]


# ---------------------------------------------------------------------
# Benchmark definitions
# ---------------------------------------------------------------------


@dataclass
class Benchmark:
    key: str
    title: str
    boriel_bas: str
    boriel_stem: str
    boriel_timeout: float
    loco_bas: str
    loco_timeout: float
    # Whether the *main* Boriel build needs -D __CPC_PRINTER_ECHO__ for its
    # result PRINT statement(s) to reach the printer. The S/E markers
    # themselves are always sent via the inline-ASM MC_PRINT_CHAR route
    # (bypasses echo either way -- see README.md), so this only matters
    # for the checksum printed after E. False only for benchmark 6's
    # "clean" build, which prints no checksum (echo would distort its
    # timed section -- see boriel_echoed_bas below).
    boriel_echo: bool = True
    # Optional: a second Boriel build used only for a distortion estimate
    # (benchmark 6 -- see README.md).
    boriel_echoed_bas: str | None = None
    boriel_echoed_stem: str | None = None


BENCHMARKS = [
    Benchmark(
        key="bm7",
        title="1. BM7 (Rugg/Feldman)",
        boriel_bas="bench1_bm7.bas",
        boriel_stem="BENCH1",
        boriel_timeout=20,
        loco_bas="bench1_bm7.bas",
        loco_timeout=60,
    ),
    Benchmark(
        key="intloop",
        title="2. Integer loop (1500 iter)",
        boriel_bas="bench2_intloop.bas",
        boriel_stem="BENCH2",
        boriel_timeout=20,
        loco_bas="bench2_intloop.bas",
        loco_timeout=60,
    ),
    Benchmark(
        key="sieve",
        title="3. Sieve of Eratosthenes (<2000)",
        boriel_bas="bench3_sieve.bas",
        boriel_stem="BENCH3",
        boriel_timeout=20,
        loco_bas="bench3_sieve.bas",
        loco_timeout=90,
    ),
    Benchmark(
        key="float",
        title="4. Float maths (200 iter)",
        boriel_bas="bench4_float.bas",
        boriel_stem="BENCH4",
        boriel_timeout=90,
        loco_bas="bench4_float.bas",
        loco_timeout=120,
    ),
    Benchmark(
        key="strings",
        title="5. Strings (2000 iter)",
        boriel_bas="bench5_strings.bas",
        boriel_stem="BENCH5",
        boriel_timeout=20,
        loco_bas="bench5_strings.bas",
        loco_timeout=60,
    ),
    Benchmark(
        key="print",
        title="6. Screen PRINT (1..600)",
        boriel_bas="bench6_print_clean.bas",
        boriel_stem="BENCH6C",
        boriel_timeout=60,
        loco_bas="bench6_print.bas",
        loco_timeout=90,
        boriel_echo=False,
        boriel_echoed_bas="bench6_print_echoed.bas",
        boriel_echoed_stem="BENCH6E",
    ),
]


def median_spread(values: list[float]) -> tuple[float, float, float]:
    s = sorted(values)
    return statistics.median(s), s[0], s[-1]


def main() -> int:
    env = env_with_path()
    WORK_DIR.mkdir(exist_ok=True)

    print(f"# CPC speed comparison -- Boriel BASIC (--arch cpc) vs Locomotive BASIC 1.1", file=sys.stderr)
    print(f"# {REPEATS} repeats per measurement, poll interval {POLL_INTERVAL*1000:.0f} ms\n", file=sys.stderr)

    rows = []
    selected = set(sys.argv[1:])  # optional benchmark keys, e.g. `bench.py float`
    for bm in BENCHMARKS:
        if selected and bm.key not in selected:
            continue
        print(f"=== {bm.title} ===", file=sys.stderr)

        print(f"  compiling boriel...", file=sys.stderr, flush=True)
        dsk_path = build_boriel(bm.boriel_bas, bm.boriel_stem, echo=bm.boriel_echo, env=env)

        boriel_times = []
        boriel_result_lines: list[str] = []
        for i in range(REPEATS):
            print(f"  boriel run {i+1}/{REPEATS}...", file=sys.stderr, flush=True)
            r = run_boriel_dsk(dsk_path, bm.boriel_stem, timeout=bm.boriel_timeout)
            if r.elapsed is None:
                print(f"    WARNING: no S/E pair captured (timed_out={r.timed_out}); text={r.text!r}", file=sys.stderr)
            else:
                boriel_times.append(r.elapsed)
                boriel_result_lines = r.result_lines

        boriel_echo_times = []
        boriel_echo_result_lines: list[str] = []
        if bm.boriel_echoed_bas:
            print(f"  compiling boriel (echoed)...", file=sys.stderr, flush=True)
            echo_dsk_path = build_boriel(bm.boriel_echoed_bas, bm.boriel_echoed_stem, echo=True, env=env)
            for i in range(REPEATS):
                print(f"  boriel (echoed) run {i+1}/{REPEATS}...", file=sys.stderr, flush=True)
                r = run_boriel_dsk(echo_dsk_path, bm.boriel_echoed_stem, timeout=bm.boriel_timeout * 2)
                if r.elapsed is None:
                    print(f"    WARNING: no S/E pair captured; text={r.text!r}", file=sys.stderr)
                else:
                    boriel_echo_times.append(r.elapsed)
                    boriel_echo_result_lines = r.result_lines

        loco_lines = read_loco_lines(bm.loco_bas)
        loco_times = []
        loco_internal_times = []
        loco_result_lines: list[str] = []
        for i in range(REPEATS):
            print(f"  locomotive run {i+1}/{REPEATS}...", file=sys.stderr, flush=True)
            printer_path = WORK_DIR / f"loco_{bm.key}_printer.dat"
            r = run_locomotive(loco_lines, bm.loco_timeout, printer_path)
            if r.elapsed is None:
                print(f"    WARNING: no S/E pair captured (timed_out={r.timed_out}); text={r.text!r}", file=sys.stderr)
                continue
            loco_times.append(r.elapsed)
            rl = r.result_lines
            # First result line is always the internal TIME cross-check
            # ((TIME-t)/300), printed by every locomotive/*.bas program.
            if rl:
                try:
                    loco_internal_times.append(float(rl[0]))
                except ValueError:
                    pass
            loco_result_lines = rl[1:]

        rows.append(
            dict(
                bm=bm,
                boriel_times=boriel_times,
                boriel_result=boriel_result_lines,
                boriel_echo_times=boriel_echo_times,
                boriel_echo_result=boriel_echo_result_lines,
                loco_times=loco_times,
                loco_internal_times=loco_internal_times,
                loco_result=loco_result_lines,
            )
        )

    # ---- report ----
    print()
    print("| Benchmark | Locomotive s (median, min-max) | Boriel s (median, min-max) | Speed-up x | Result check |")
    print("|---|---|---|---|---|")
    for row in rows:
        bm = row["bm"]
        loco_med = loco_lo = loco_hi = None
        if row["loco_times"]:
            loco_med, loco_lo, loco_hi = median_spread(row["loco_times"])
        boriel_med = boriel_lo = boriel_hi = None
        if row["boriel_times"]:
            boriel_med, boriel_lo, boriel_hi = median_spread(row["boriel_times"])

        loco_str = f"{loco_med:.3f} ({loco_lo:.3f}-{loco_hi:.3f})" if loco_med is not None else "N/A"
        boriel_str = f"{boriel_med:.3f} ({boriel_lo:.3f}-{boriel_hi:.3f})" if boriel_med is not None else "N/A"
        speedup = f"{loco_med/boriel_med:.1f}x" if (loco_med and boriel_med) else "N/A"

        check = f"loco={row['loco_result']} boriel={row['boriel_result']}"
        print(f"| {bm.title} | {loco_str} | {boriel_str} | {speedup} | {check} |")

        if row["boriel_echo_times"]:
            e_med, e_lo, e_hi = median_spread(row["boriel_echo_times"])
            print(
                f"|   (distortion check: same Boriel program, built WITH printer echo) "
                f"| | {e_med:.3f} ({e_lo:.3f}-{e_hi:.3f}) | "
                f"{(e_med/boriel_med) if boriel_med else float('nan'):.2f}x slower than clean | "
                f"boriel(echoed)={row['boriel_echo_result']} |"
            )

        if row["loco_internal_times"]:
            im = statistics.median(row["loco_internal_times"])
            ext = loco_med if loco_med is not None else float("nan")
            print(f"|   (Locomotive TIME cross-check: internal median {im:.3f}s vs external {ext:.3f}s) | | | | |")

    kill_stray_cap32()
    return 0


if __name__ == "__main__":
    sys.exit(main())
