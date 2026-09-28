#!/usr/bin/env python3
"""micro.py -- per-operation float cost, Boriel (--arch cpc) vs Locomotive BASIC.

Each operation runs in its own timed loop (y = <expr>, N iterations) in both
languages. The same loop with a bare assignment (y = a) is timed too, and its
time is subtracted, so the result is the cost of one call of the operation.
Timing uses bench.py's printer start/end markers.
Generated sources go to micro/boriel and micro/locomotive.

Usage: python3 micro.py [op ...]
"""

from __future__ import annotations

import statistics
import sys
from pathlib import Path

import bench

MICRO = bench.BENCH_DIR / "micro"
REPEATS = 2

# name, BASIC expression (a (boriel, locomotive) pair where the languages differ), iterations
OPS = [
    ("base", "a", None),
    ("add", "a+b", 500),
    ("sub", "a-b", 500),
    ("mul", "a*b", 500),
    ("div", "a/b", 500),
    ("sqr", "SQR(a)", 100),
    ("sin", "SIN(a)", 100),
    ("cos", "COS(a)", 100),
    ("exp", "EXP(a)", 100),
    ("ln", ("LN(a)", "LOG(a)"), 100),  # Locomotive's natural log is LOG
    ("atn", "ATN(a)", 100),
]

BORIEL_TEMPLATE = """\
DIM i AS UInteger
DIM a, b, y AS FLOAT
a = 1.2345
b = 2.3456

ASM
    jr PRNSTR_SKIP
PRNSTR:
    ld a,(hl)
    or a
    ret z
    push hl
    call .core.__FW_CALL
    defw $BD2B
    pop hl
    inc hl
    jr PRNSTR
PRNSTR_SKIP:
MSG_S: defb "S",10,0
MSG_E: defb "E",10,0
MSG_D: defb "DONE",10,0
END ASM

ASM
    ld hl, MSG_S
    call PRNSTR
END ASM

FOR i = 1 TO {n}
  y = {expr}
NEXT i

ASM
    ld hl, MSG_E
    call PRNSTR
END ASM

PRINT y

ASM
    ld hl, MSG_D
    call PRNSTR
END ASM

END
"""

LOCO_TEMPLATE = """\
10 DEFINT i
20 a=1.2345:b=2.3456
30 PRINT#8,"S"
40 t=TIME
50 FOR i=1 TO {n}
60 y={expr}
70 NEXT i
80 e=TIME
90 PRINT#8,"E"
100 PRINT#8,(e-t)/300
110 PRINT#8,y
120 PRINT#8,"DONE"
"""


def measure(name: str, expr: str, n: int, env: dict[str, str]) -> tuple[float, float, list[str], list[str]]:
    stem = f"M{name.upper()}{n}"[:8]
    bdir, ldir = MICRO / "boriel", MICRO / "locomotive"
    bdir.mkdir(parents=True, exist_ok=True)
    ldir.mkdir(parents=True, exist_ok=True)
    bexpr, lexpr = expr if isinstance(expr, tuple) else (expr, expr)
    (bdir / f"{name}_{n}.bas").write_text(BORIEL_TEMPLATE.format(n=n, expr=bexpr))
    (ldir / f"{name}_{n}.bas").write_text(LOCO_TEMPLATE.format(n=n, expr=lexpr))

    bench.BORIEL_DIR = bdir
    bench.LOCO_DIR = ldir
    dsk = bench.build_boriel(f"{name}_{n}.bas", stem, echo=True, env=env)  # echo only affects the PRINT after E
    timeout = 20 + n * 0.25
    b_times, l_times, b_out, l_out = [], [], [], []
    for _ in range(REPEATS):
        r = bench.run_boriel_dsk(dsk, stem, timeout=timeout)
        if r.elapsed is not None:
            b_times.append(r.elapsed)
            b_out = r.result_lines
        r = bench.run_locomotive(bench.read_loco_lines(f"{name}_{n}.bas"), timeout, bench.WORK_DIR / f"L{stem}.dat")
        if r.elapsed is not None:
            l_times.append(r.elapsed)
            l_out = r.result_lines
    if not b_times or not l_times:
        sys.exit(f"{name}: no timing captured (boriel={b_times} loco={l_times})")
    return statistics.median(b_times), statistics.median(l_times), b_out, l_out


def main() -> int:
    env = bench.env_with_path()
    bench.WORK_DIR.mkdir(exist_ok=True)
    wanted = set(sys.argv[1:])
    ns = sorted({n for _, _, n in OPS if n})
    base = {n: measure("base", "a", n, env) for n in ns}

    rows = []
    for name, expr, n in OPS:
        if n is None or (wanted and name not in wanted):
            continue
        tb, tl, bo, lo = measure(name, expr, n, env)
        bb, bl = base[n][0], base[n][1]
        pb, pl = (tb - bb) / n * 1000, (tl - bl) / n * 1000
        label = " / ".join(expr) if isinstance(expr, tuple) else expr
        rows.append((label, pb, pl, pl / pb if pb > 0 else float("inf"), bo[:1], lo[1:2]))
        print(f"{label}: boriel {pb:.3f} ms, locomotive {pl:.3f} ms", file=sys.stderr, flush=True)

    print("| Operation | Boriel ms/call | Locomotive ms/call | Boriel speed-up | y (Boriel / Locomotive) |")
    print("|---|---|---|---|---|")
    for expr, pb, pl, x, bo, lo in rows:
        print(f"| `{expr}` | {pb:.3f} | {pl:.3f} | {x:.2f}x | {bo} / {lo} |")
    for n in ns:
        print(f"\nLoop overhead per iteration (N={n}): Boriel {base[n][0] / n * 1000:.3f} ms, "
              f"Locomotive {base[n][1] / n * 1000:.3f} ms (includes y=a)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
