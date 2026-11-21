# CPC speed comparison: cpcbas vs Locomotive BASIC 1.1

A fair-as-practical speed comparison between programs compiled with cpcbas
(CPC BASIC, compiled to Z80) and the same algorithms typed
into the Amstrad CPC 6128's built-in Locomotive BASIC 1.1 interpreter, both
run on headless Caprice32. Generated files (`_work/`, `micro/`) are not
committed; re-run `bench.py` / `micro.py` to regenerate results.

## Running it

```
export PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:$HOME/.local/bin:$PATH
export CPCBAS=../cpcbas     # a built cpcbas checkout (the default is the sibling ../cpcbas)
cd cpcbuild/bench
python3 bench.py
```

Prints progress to stderr and a Markdown results table to stdout. Takes
several minutes (the Locomotive side is a real 4MHz interpreter running six
programs three times each). Requires a built cpcbas
(`node $CPCBAS/packages/cpcbas/dist/bin/cpcbas.js`; programs are packed into discs
with `cpcbas dsk`) and Caprice32 (`make cap32`, or the sibling `caprice32/cap32`).
`bench/_work/` holds compiled
binaries, `.dsk` images and raw printer captures from the last run.

## Layout

- `bench.py` -- the harness (compiles/packs/runs cpcbas builds, autotypes
  and runs the Locomotive programs, times both, prints the report).
- `cpcbas/*.bas` -- the six CPC BASIC programs, plus two builds of
  benchmark 6 (see below) and `banks_bench.bas` (bank-switching costs, run by hand).
  They are the 0.1.x programs, translated with `cpcbas migrate`.
- `locomotive/*.bas` -- the Locomotive BASIC source, as plain text, in
  exactly the form typed into the emulator via autocmd.

## Timing method

Caprice32 runs at real (emulated) CPC speed even when headless and
`SDL_VIDEODRIVER=dummy`, and it `fflush`es its virtual-printer capture file
after every single byte the CPC's printer port receives (`cap32.cpp`,
`FDDECODE`/port-write handler around line 770-773). That gives a
zero-latency, host-side-readable channel out of the emulator that updates
in lock-step with emulated time.

So every benchmark program -- cpcbas and Locomotive alike -- sends a bare
`S` line to the printer immediately before the timed section and a bare
`E` line immediately after, then whatever result/checksum it wants to
report, then a `DONE` sentinel line. `bench.py` launches `cap32` with
`-O system.printer=1 -O file.printer_file=<tmp>`, polls that file every
2ms, and records the **host** wall-clock time (`time.perf_counter()`) at
the moment each marker is first seen. Elapsed = `t(E) - t(S)`. Because
`cap32` is running at real speed, host time and emulated CPC time track
each other; none of `cap32`'s own startup/compile/disk/keystroke-injection
overhead is included, since the clock only starts at the `S` marker.

`system.limit_speed` (`cap32.h`/`cap32.cpp`) defaults to **on** (`1`) --
confirmed by reading `cap32.cpp:1814`'s config load (`getIntValue(...,
default 1)`) and the throttle check at `cap32.cpp:3205` (`if
(CPC.limit_speed) // limit to original CPC speed?`) -- and `bench.py`
passes `-O system.limit_speed=1` explicitly anyway, belt and braces. Sound
is disabled (`-O sound.enabled=0`) purely to avoid opening an audio device
in CI-like environments; it has no effect on CPU timing.

Each measurement is run 3 times; the table reports the median and the
min-max spread.

### How the markers reach the printer

- **cpcbas**: a small inline `ASM ... END ASM` block in each `cpcbas/*.bas`
  file sends its `S`/`E`/`DONE` message directly to the printer via
  `MC_PRINT_CHAR` (`&BD2B`), through the firmware gate
  (`.core.__FW_CALL` / `defw $BD2B`, see cpcbas's
  `lib/runtime/fwcall.asm`). This bypasses cpcbas's own
  `PRINT`/`__PRINTCHAR` path (and therefore the `-D __CPC_PRINTER_ECHO__`
  echo mechanism, see `print.asm`) entirely, so the marker mechanism never
  distorts whatever the benchmark itself does on screen. It also means the
  same technique works whether or not the build has printer echo enabled.
  Verified working: a two-line "S" test compiled and run standalone
  produced exactly `S\n` in the capture file before any other code ran.
- **Locomotive**: `PRINT#8,"S"` / `PRINT#8,"E"` (stream 8 = printer, a
  built-in CPC BASIC 1.1 convention -- no `printer,online` or width setup
  needed for Caprice32's virtual printer). Locomotive terminates a
  `PRINT#8` line with CR+LF; the cpcbas asm markers send a bare LF. `bench.py`
  strips `\r` before comparing, so both are treated as plain `\n`-terminated
  text.

### Cross-check: Locomotive's own TIME

Independently of the external S/E measurement, every `locomotive/*.bas`
program also times itself: `t=TIME` right after the `S` marker, `e=TIME`
right before the `E` marker, and `PRINT#8,(e-t)/300` (TIME counts 1/300s
ticks) as the first line after `E`. `bench.py` parses this as
`loco_internal_times` and reports it next to the externally-measured
median. In every benchmark tried during development the two agreed to
within about 3-35ms in the final run (e.g. BM7: external 17.863s vs
internal 17.860s; strings: external 12.667s vs internal 12.640s; sieve:
external 14.273s vs internal 14.237s) -- strong cross-validation that the
polling method is measuring the same thing Locomotive's own clock is.

### Typing the Locomotive programs in

Locomotive programs are typed in via Caprice32's `-a` autocmd (one BASIC
line per `-a` argument, each followed by Enter -- `argparse.cpp` appends
`"\n"` after every `-a` token), then a final `-a RUN`. Caprice32 paces
autocmd keystrokes at one event (key-down or key-up) per emulated video
frame (`cap32.cpp`, the `nextVirtualEventFrameCount` logic), i.e. about
40ms/character at real 50Hz -- comfortably above the firmware's key
debounce, so nothing gets dropped or doubled.

Every special character the benchmark sources need -- `#`, `%`, `$`, `"`,
`:`, `(`, `)`, `*`, `!`, `/`, `^`, `<`, `>`, `=` -- was verified to
autotype correctly before writing any benchmark, using
`LIST #8` (yes, Locomotive's `LIST` takes a `#stream` argument, same as
`PRINT`) to echo the exact stored program text to the virtual printer and
diffing it against what was typed. All typed correctly with the CPC's
default `keymap_us.map`; no workaround was needed (contrast
`cpcrun.py`'s note that `_` doesn't autotype under some configurations --
not exercised here, since no benchmark needs it).

## Benchmarks

Programs are as algorithmically identical as each language allows. cpcbas
uses explicit `UInteger`/`UByte`/`FLOAT` types; Locomotive uses `DEFINT`
for integer-only benchmarks and its default `REAL` type for the float one,
per the task brief. Iteration counts were tuned (see "Tuning" below) so
Locomotive lands roughly in the 3-20s range the task asked for; two
benchmarks (BM7, screen PRINT) land slightly outside it for reasons noted
per-benchmark below.

1. **BM7** (`bench1_bm7.bas`) -- the classic Rugg/Feldman integer
   benchmark (loop+arithmetic+GOSUB+array fill), timed externally.
   Outer loop reduced from the canonical 1000 to 800 to land
   Locomotive under ~20s.
2. **Integer loop** (`bench2_intloop.bas`) -- 1500 iterations of
   sum/bitwise-AND/compare. See "Caveats" below for why the mask is
   8191, not 32767.
3. **Sieve of Eratosthenes** (`bench3_sieve.bas`) -- primes below 2000
   (reduced from the suggested 5000 so Locomotive lands under 20s), byte
   array, prints the count at the end (669 primes below 5000 in the
   original range; 303 below 2000 -- both sides agreed).
4. **Float maths** (`bench4_float.bas`) -- 200 iterations (reduced from
   300) of `x = SQR(i)*SIN(i) + i/3`, `FLOAT` vs default `REAL`. cpcbas
   calls the firmware's floating-point routines, as Locomotive does, so the
   two are close.
5. **Strings** (`bench5_strings.bas`) -- 2000 iterations of clear/append/
   append/LEN.
6. **Screen PRINT** (`bench6_print_clean.bas` / `bench6_print_echoed.bas`
   / `locomotive/bench6_print.bas`) -- `PRINT i;" ";` for i=1..600 (reduced
   from 1000). Firmware-bound in both languages, so expected to be
   similar; see "The echo-distortion problem" below for why this one
   benchmark needs two cpcbas builds.

All benchmarks print a result/checksum after `E` so both sides can be
compared; see the results table for actual values and any mismatches
(expected in a couple of cases -- noted below).

## Results (reference run)

Median of 3 runs each (min-max in parentheses), produced by `python3
bench.py` on this machine. Re-running will vary slightly with host load,
but the polling method being read off the CPC's own real-time clock (via
Caprice32's real-speed emulation) keeps run-to-run variance small, as the
narrow min-max spreads below show.

### cpcbas 0.2.0-dev (2026-11-13)

The programs in `cpcbas/` (the 0.1.x programs, translated), built by cpcbas.

| Benchmark | Locomotive s (median, min-max) | cpcbas s (median, min-max) | Speed-up x | Result check |
|---|---|---|---|---|
| 1. BM7 (Rugg/Feldman) | 17.820 (17.819-17.841) | 1.181 (1.180-1.181) | 15.1x | loco=[7, 800] cpcbas=[5, 800] |
| 2. Integer loop (1500 iter) | 7.301 (7.300-7.356) | 0.142 (0.141-0.142) | 51.5x | loco=[2731] cpcbas=[2731] |
| 3. Sieve of Eratosthenes (<2000) | 14.241 (14.238-14.259) | 1.302 (1.298-1.302) | 10.9x | loco=[303] cpcbas=[303] |
| 4. Float maths (200 iter) | 9.563 (9.559-9.563) | 8.901 (8.901-8.963) | 1.1x | loco=[6688.08573] cpcbas=[6688.08573] |
| 5. Strings (2000 iter) | 12.650 (12.620-12.657) | 3.260 (3.259-3.262) | 3.9x | loco=[8000] cpcbas=[8000] |
| 6. Screen PRINT (1..600) | 17.451 (17.446-17.477) | 14.017 (13.980-14.050) | 1.2x | loco=[300] cpcbas(echoed)=[300] |

Benchmark 6 prints what Locomotive's `PRINT` prints: a sign position before
the number and a space after it, so each item is two characters longer. The
"distortion check" row (the same program built with printer echo) measured
15.321 s, 1.09x the clean build. Benchmark 4 calls the CPC firmware's
floating-point routines, as Locomotive does, which is why the two are close.

These rows are not set beside the figures of the 0.1.x compiler: that was
another compiler, measured on another day, and the ratio of two such runs
says little about either.

Locomotive's internal `TIME`-based self-measurement matched the external
S/E polling method to within 3-35ms on every benchmark (see "Cross-check"
above) -- e.g. BM7: 17.860s internal vs 17.863s external.

Result checks: benchmarks 2 to 6 match exactly between the two
languages. Benchmark 1 (BM7) differs for a documented, expected reason --
integer division/rounding semantics -- see "Caveats" below, not a bug in
either implementation.

## The echo-distortion problem (benchmark 6)

`-D __CPC_PRINTER_ECHO__` (the flag `cpcrun.py` always compiles with, and
this harness uses for every *other* benchmark so their checksums can
reach the printer) makes cpcbas's `print.asm` mirror every character
actually sent to `TXT_OUTPUT` to the printer too, via a second
`MC_PRINT_CHAR` firmware call per character (`__PRN_ECHO` in
`print.asm`). For benchmarks 1-5 nothing is printed to the screen during
the timed section at all, so this is irrelevant -- echo only ever touches
the one-shot `PRINT`-based checksum printed *after* the `E` marker, well
outside the timed window (and even that is now moot: this harness's
S/E/DONE markers are always the inline-ASM/`MC_PRINT_CHAR` kind, never a
`PRINT`-based one, precisely to keep echo out of the timing picture; see
above). Benchmark 6 is different: its *entire timed section* is 600
`PRINT i;" ";` statements, so building it with echo doubles the firmware
printer traffic the loop itself generates, distorting the very thing being
measured.

So benchmark 6 has two cpcbas builds:

- `bench6_print_clean.bas`, compiled **without** the echo flag: the timed
  loop's `PRINT` statements behave exactly as they would in any ordinary
  program (screen only), and the S/E/DONE markers reach the printer via
  the same inline-ASM `MC_PRINT_CHAR` route used everywhere else -- no
  checksum is printed here (it wouldn't reach the printer without echo),
  since correctness is already confirmed by the echoed build below. **This
  is the build whose time is reported as "cpcbas" in the results table.**
- `bench6_print_echoed.bas`, compiled **with** the echo flag: identical
  source otherwise, used only (a) to confirm the checksum matches
  Locomotive's, and (b) to measure the actual size of the distortion.
  Measured distortion was much smaller than the naively-expected "roughly
  2x": 14.017s clean vs 15.321s echoed (median of 3), i.e. only about
  **1.09x** slower with echo on, not 2x -- the per-character firmware
  print/scroll cost in `TXT_OUTPUT` evidently dominates over the extra
  `MC_PRINT_CHAR` echo call, rather than the two being comparable. See the
  results table's "distortion check" row.

The task's preference for using the inline-ASM marker trick *everywhere*
("so no benchmark is affected by echo mode") is followed for all six
benchmarks -- every S/E/DONE marker in every `cpcbas/*.bas` file goes
through the same `MC_PRINT_CHAR`-via-gate snippet, never through
`PRINT`/echo. Only the *checksum* after `E` still relies on ordinary
`PRINT` (and hence, for benchmarks 1-5, on the echo flag being on) --
switching that to the same inline-ASM approach would need a second,
string-walking asm routine to convert the numeric
result to text and walk it; not attempted, since the checksum print always
happens after `E`, outside every timed section, so it cannot distort any
measurement regardless of which path it takes.

## Caveats

- **Interrupts.** Compiled programs run with interrupts enabled, like Locomotive BASIC: about 12 % of the CPU goes to the
  firmware's 300 Hz interrupt handler in both. What compiled code gains is straight-line speed, and music or real-time
  graphics without the firmware's I/O pacing.
- **Float semantics.** cpcbas and Locomotive use the firmware's own 5-byte real format, so benchmark 4's checksum matches
  exactly (6688.08573) once both loop counters are reals. Division between integer-typed operands differs by language
  semantics (see BM7 below).
- **Locomotive's integer arithmetic is 16-bit *signed*** (-32768..32767),
  and overflowing it raises a runtime error rather than wrapping. A compiled `UInteger` is 16-bit *unsigned* and wraps
  silently. Any checksum comparison between an integer benchmark's two
  sides should be read with this in mind, not just as "did the numbers
  match". That is why benchmark 2 masks its sum with 8191: a first version masked with 32767, which only ever clears
  bit 15, so the sum grew until Locomotive stopped on an Overflow error with nothing left to send to the printer
  (the symptom from the harness was a timeout, not a crash).
- **BM7's `v` checksum differs between the two sides on purpose**, and
  the reason is itself informative: `v = k/2*3+4-5` with `k=5`. cpcbas
  performs `/` between two integer-typed operands as *integer* division
  (truncating early: `5/2 -> 2`), giving `v=5`. Locomotive computes the
  whole expression in real arithmetic and rounds only at the final
  assignment to the `DEFINT` variable (`5/2=2.5 -> ... -> 6.5 -> rounds to
  7`), giving `v=7`. Both are "correct" for their own language's
  documented semantics; this is exactly the kind of divergence a classic
  BASIC benchmark is designed to surface, not a bug in either.


## Per-operation float costs (`micro.py`)

`python3 micro.py [op ...]` times each operation in its own loop (y = <expr>)
in both languages. It subtracts the same loop with a bare `y = a`, which
leaves the per-call cost.

### cpcbas 0.2.0-dev (2026-11-13)

| Operation | cpcbas ms/call | Locomotive ms/call | Speed-up (Locomotive time / cpcbas time) |
|---|---|---|---|
| `a+b` | 0.59 | 0.92 | 1.55x |
| `a-b` | 0.64 | 0.95 | 1.50x |
| `a*b` | 1.72 | 1.88 | 1.09x |
| `a/b` | 2.37 | 2.28 | 0.96x |
| `SQR(a)` | 26.4 | 26.8 | 1.01x |
| `SIN(a)` | 13.4 | 13.8 | 1.03x |
| `COS(a)` | 14.2 | 14.6 | 1.03x |
| `EXP(a)` | 12.8 | 13.2 | 1.03x |
| `LOG(a)` | 12.6 | 13.0 | 1.04x |
| `ATN(a)` | 23.4 | 24.0 | 1.02x |

cpcbas calls the same firmware routines as Locomotive, so the functions cost the same and every result agrees to the digit.
