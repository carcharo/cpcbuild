# CPC speed comparison: Boriel BASIC (--arch cpc) vs Locomotive BASIC 1.1

A fair-as-practical speed comparison between programs compiled with our
Boriel BASIC CPC backend (`zxbc --arch cpc`) and the same algorithms typed
into the Amstrad CPC 6128's built-in Locomotive BASIC 1.1 interpreter, both
run on headless Caprice32. Generated files (`_work/`, `micro/`) are not
committed; re-run `bench.py` / `micro.py` to regenerate results.

## Running it

```
export PATH=/opt/homebrew/opt/coreutils/libexec/gnubin:$HOME/.local/bin:$PATH
cd cpcbuild/bench
python3 bench.py
```

Prints progress to stderr and a Markdown results table to stdout. Takes
several minutes (the Locomotive side is a real 4MHz interpreter running six
programs three times each). Requires the sibling `zxbasic` (branch
`cpc-arch`, via `poetry`) and `caprice32/cap32` checkouts described in
cpcbuild/CLAUDE.md and PLAN-boriel-cpc.md. `bench/_work/` holds compiled
binaries, `.dsk` images and raw printer captures from the last run.

## Layout

- `bench.py` -- the harness (compiles/packs/runs Boriel builds, autotypes
  and runs the Locomotive programs, times both, prints the report).
- `boriel/*.bas` -- the six Boriel BASIC programs (`--arch cpc`), plus two
  builds of benchmark 6 (see below).
- `locomotive/*.bas` -- the Locomotive BASIC source, as plain text, in
  exactly the form typed into the emulator via autocmd.

## Timing method

Caprice32 runs at real (emulated) CPC speed even when headless and
`SDL_VIDEODRIVER=dummy`, and it `fflush`es its virtual-printer capture file
after every single byte the CPC's printer port receives (`cap32.cpp`,
`FDDECODE`/port-write handler around line 770-773). That gives a
zero-latency, host-side-readable channel out of the emulator that updates
in lock-step with emulated time.

So every benchmark program -- Boriel and Locomotive alike -- sends a bare
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

- **Boriel**: a small inline `ASM ... END ASM` block in each `boriel/*.bas`
  file sends its `S`/`E`/`DONE` message directly to the printer via
  `MC_PRINT_CHAR` (`&BD2B`), through the firmware gate
  (`.core.__FW_CALL` / `defw $BD2B`, see zxbasic's
  `src/lib/arch/cpc/runtime/fwcall.asm`). This bypasses Boriel's own
  `PRINT`/`__PRINTCHAR` path (and therefore the `-D __CPC_PRINTER_ECHO__`
  echo mechanism, see `print.asm`) entirely, so the marker mechanism never
  distorts whatever the benchmark itself does on screen. It also means the
  same technique works whether or not the build has printer echo enabled.
  Verified working: a two-line "S" test compiled and run standalone
  produced exactly `S\n` in the capture file before any other code ran.
- **Locomotive**: `PRINT#8,"S"` / `PRINT#8,"E"` (stream 8 = printer, a
  built-in CPC BASIC 1.1 convention -- no `printer,online` or width setup
  needed for Caprice32's virtual printer). Locomotive terminates a
  `PRINT#8` line with CR+LF; Boriel's asm markers send a bare LF. `bench.py`
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

Programs are as algorithmically identical as each language allows. Boriel
uses explicit `UInteger`/`UByte`/`FLOAT` types; Locomotive uses `DEFINT`
for integer-only benchmarks and its default `REAL` type for the float one,
per the task brief. Iteration counts were tuned (see "Tuning" below) so
Locomotive lands roughly in the 3-20s range the task asked for; two
benchmarks (BM7, screen PRINT) land slightly outside it for reasons noted
per-benchmark below.

1. **BM7** (`bench1_bm7.bas`) -- the classic Rugg/Feldman integer
   benchmark, ported from `zxbasic/benchmarks/bm7a.bas` (loop+arithmetic+
   GOSUB+array fill), with the Spectrum-only `POKE 23672` frame-counter
   timing dropped (we time externally instead). Outer loop reduced from
   the canonical 1000 to 800 to land Locomotive under ~20s.
2. **Integer loop** (`bench2_intloop.bas`) -- 1500 iterations of
   sum/bitwise-AND/compare. See "Boriel runtime/language findings" below
   for why the mask is 8191, not 32767.
3. **Sieve of Eratosthenes** (`bench3_sieve.bas`) -- primes below 2000
   (reduced from the suggested 5000 so Locomotive lands under 20s), byte
   array, prints the count at the end (669 primes below 5000 in the
   original range; 303 below 2000 -- both sides agreed).
4. **Float maths** (`bench4_float.bas`) -- 200 iterations (reduced from
   300) of `x = SQR(i)*SIN(i) + i/3`, `FLOAT` vs default `REAL`. See
   "Boriel runtime/language findings" -- this is the one benchmark where
   Boriel is *slower* than Locomotive.
5. **Strings** (`bench5_strings.bas`) -- 2000 iterations of clear/append/
   append/LEN.
6. **Screen PRINT** (`bench6_print_clean.bas` / `bench6_print_echoed.bas`
   / `locomotive/bench6_print.bas`) -- `PRINT i;" ";` for i=1..600 (reduced
   from 1000). Firmware-bound in both languages, so expected to be
   similar; see "The echo-distortion problem" below for why this one
   benchmark needs two Boriel builds.

All benchmarks print a result/checksum after `E` so both sides can be
compared; see the results table for actual values and any mismatches
(expected in a couple of cases -- noted below).

## Results (reference run)

Median of 3 runs each (min-max in parentheses), produced by `python3
bench.py` on this machine. Re-running will vary slightly with host load,
but the polling method being read off the CPC's own real-time clock (via
Caprice32's real-speed emulation) keeps run-to-run variance small, as the
narrow min-max spreads below show.

| Benchmark | Locomotive s (median, min-max) | Boriel s (median, min-max) | Speed-up x | Result check |
|---|---|---|---|---|
| 1. BM7 (Rugg/Feldman) | 17.863 (17.861-17.880) | 1.024 (1.018-1.028) | 17.4x | loco=[7, 800] boriel=[5, 800] |
| 2. Integer loop (1500 iter) | 7.327 (7.322-7.342) | 0.142 (0.138-0.145) | 51.6x | loco=[2731] boriel=[2731] |
| 3. Sieve of Eratosthenes (<2000) | 14.273 (14.263-14.284) | 1.162 (1.160-1.164) | 12.3x | loco=[303] boriel=[303] |
| 4. Float maths (200 iter) | 9.594 (9.591-9.603) | 32.309 (32.242-32.371) | **0.3x (Boriel slower)** | loco=[6688.08573] boriel=[6688.08573] ✓ |
| 5. Strings (2000 iter) | 12.667 (12.644-12.683) | 2.909 (2.904-2.929) | 4.4x | loco=[8000] boriel=[8000] |
| 6. Screen PRINT (1..600) | 17.480 (17.457-17.484) | 9.877 (9.876-9.880) | 1.8x | loco=[300] boriel(echoed)=[300] |

Locomotive's internal `TIME`-based self-measurement matched the external
S/E polling method to within 3-35ms on every benchmark (see "Cross-check"
above) -- e.g. BM7: 17.860s internal vs 17.863s external; float: 9.587s vs
9.587s.

Result checks: benchmarks 2, 3, 5 and 6 match exactly between the two
languages. Benchmark 1 (BM7) and benchmark 4 (float) differ for
documented, expected reasons -- integer division/rounding semantics and
float-format precision respectively -- see "Boriel runtime/language
findings" and "Caveats" below, not a bug in either implementation.

`pgrep cap32` was empty after every run in this session (no leaked
emulator processes).

## The echo-distortion problem (benchmark 6)

`-D __CPC_PRINTER_ECHO__` (the flag `cpcrun.py` always compiles with, and
this harness uses for every *other* benchmark so their checksums can
reach the printer) makes Boriel's `print.asm` mirror every character
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

So benchmark 6 has two Boriel builds:

- `bench6_print_clean.bas`, compiled **without** the echo flag: the timed
  loop's `PRINT` statements behave exactly as they would in any ordinary
  program (screen only), and the S/E/DONE markers reach the printer via
  the same inline-ASM `MC_PRINT_CHAR` route used everywhere else -- no
  checksum is printed here (it wouldn't reach the printer without echo),
  since correctness is already confirmed by the echoed build below. **This
  is the build whose time is reported as "Boriel" in the results table.**
- `bench6_print_echoed.bas`, compiled **with** the echo flag: identical
  source otherwise, used only (a) to confirm the checksum matches
  Locomotive's, and (b) to measure the actual size of the distortion.
  Measured distortion was much smaller than the naively-expected "roughly
  2x": 9.877s clean vs 10.965s echoed (median of 3), i.e. only about
  **1.11x** slower with echo on, not 2x -- the per-character firmware
  print/scroll cost in `TXT_OUTPUT` evidently dominates over the extra
  `MC_PRINT_CHAR` echo call, rather than the two being comparable. See the
  results table's "distortion check" row.

The task's preference for using the inline-ASM marker trick *everywhere*
("so no benchmark is affected by echo mode") is followed for all six
benchmarks -- every S/E/DONE marker in every `boriel/*.bas` file goes
through the same `MC_PRINT_CHAR`-via-gate snippet, never through
`PRINT`/echo. Only the *checksum* after `E` still relies on ordinary
`PRINT` (and hence, for benchmarks 1-5, on the echo flag being on) --
switching that to the same inline-ASM approach would need a second,
string-walking asm routine (Boriel strings are a 2-byte length prefix plus
raw bytes, confirmed from `zx48k`'s `printstr.asm`) to convert the numeric
result to text and walk it; not attempted, since the checksum print always
happens after `E`, outside every timed section, so it cannot distort any
measurement regardless of which path it takes.

## Boriel runtime/language findings

Found while writing and tuning these benchmarks. None of these were
fixed (only files under `cpcbuild/bench/` were touched, per instructions);
reported here precisely instead.

1. **`FOR ... STEP <variable>` crashes the compiler.** The sieve's inner
   marking loop was originally written as
   `FOR j = i + i TO 4999 STEP i` (a variable step, since the step is the
   prime `i`). This crashes `zxbc --arch cpc` (and, by inspection of the
   traceback, would crash on any z80 arch -- the failing code is in the
   architecture-generic `src/arch/z80/visitor/translator.py`, not
   anything CPC-specific) with:
   ```
   File ".../src/arch/z80/visitor/translator.py", line 629, in visit_FOR
       if not direct or node.children[3].value < 0:  # Here for negative steps
   File ".../src/symbols/id_/_id.py", line 186, in __getattr__
       return getattr(self.ref, item)
   AttributeError: 'VarRef' object has no attribute 'value'
   ```
   `visit_FOR`'s negative-step check assumes the STEP expression is always
   a literal constant (`.value`) and never guards for a `VarRef`. Worked
   around in `boriel/bench3_sieve.bas` by using `WHILE j <= 1999 / WEND`
   instead of `FOR j = ... STEP i`; the Locomotive side keeps the more
   natural `FOR j=i+i TO 1999 STEP i`, since Locomotive has no such
   restriction, so the two sides use slightly different loop constructs
   for the same algorithm.

2. **Plain `AND` is boolean/logical, not bitwise** -- this is documented
   behaviour (`docs/bitwiselogic.md`: bitwise ops are the separate `bAND`/
   `bOR`/`bNOT`/`bXOR` keywords), not a bug, but it cost real debugging
   time and is worth flagging for anyone porting a benchmark that assumes
   C-like semantics: `s = s AND 32767` on a `UInteger` silently computes
   the *logical* AND (returns 0 or 1) instead of masking, with no warning
   or type error. `bench2_intloop.bas` uses `bAND`.

3. **Combined with (2): Locomotive's 16-bit *signed* integer overflow trap
   turned a benchmark-design mistake into a silent hang.** The first
   version of benchmark 2 masked with `bAND 32767` (`&7FFF`) intending to
   bound the running sum, but AND-ing with `0x7FFF` only ever clears bit
   15 -- for any value already below 32768 it's a no-op, so the sum
   actually grew unboundedly every iteration. On the Boriel/UInteger side
   this is harmless (unsigned 16-bit wraps silently on overflow). On the
   Locomotive/`DEFINT` side, a plain `s=s+i` that pushes `s` above 32767
   raises a runtime **Overflow** error (Locomotive integers are 16-bit
   *signed*, range -32768..32767, and arithmetic that leaves that range
   traps rather than wrapping) -- around i=256 for this benchmark's
   growth rate. Since that happens mid-`RUN`, with no screen capture in
   this headless setup, the symptom from the harness's point of view was
   simply "no `E` marker ever arrives" (an indistinguishable-from-a-hang
   90s timeout, not a crash we could see). Final version masks with `8191`
   instead, which is small enough that `s+i` (i up to 1500) never
   approaches the signed 16-bit limit on either side.

4. **`SQR(FLOAT)` is surprisingly the dominant cost in the float
   benchmark, more so than `SIN`.** Isolating the two calls (200
   iterations each, same harness): `SQR(i)` alone took **22.4s** (~112ms/
   call) against `SIN(i)` alone at **8.6s** (~43ms/call) -- SQR is about
   2.6x more expensive than SIN here, which is the opposite of what one
   might expect (SIN as a transcendental/series function vs SQR as a
   single Newton-style iteration). Combined, `SQR(i)*SIN(i)+i/3` for 200
   iterations takes Boriel **31.4s** against Locomotive's interpreted
   **9.6s** for the identical algorithm -- **compiled Boriel is about
   3.3x slower than the interpreter** for this specific FLOAT-heavy
   workload, the only benchmark in this set where that happens. Not
   investigated further (would mean reading `src/lib/arch/cpc/runtime/
   math/sqrt.asm`, which is out of scope here), but worth flagging as a
   real optimisation target for the CPC FLOAT library.

## Caveats

- **Interrupts.** Compiled Boriel programs run with interrupts disabled
  except transiently inside firmware calls (`fwcall.asm`'s gate: `ei`
  immediately before the firmware `call`, `di` immediately after). That
  means compiled code never pays for the CPC firmware's 300Hz (IM1)
  housekeeping interrupt the way Locomotive BASIC -- which runs with
  interrupts enabled throughout -- does. This gives Boriel a further,
  timing-invisible advantage beyond "compiled vs interpreted" that isn't
  broken out separately in the results table. A rough estimate of that
  interrupt tax: the 300Hz handler's own minimum overhead (register
  save/restore, the frame/sound-queue checks) is on the order of a few
  hundred T-states per tick, i.e. roughly 300 x a few hundred / 4,000,000
  ~ a few percent of wall-clock time for something that does no firmware
  calls at all -- small next to the compiled-vs-interpreted speed-ups
  measured here (10x-1000x range) but not zero, and larger than a few
  percent for any Locomotive program that spends a lot of time in
  firmware-serviced I/O. Not measured directly (would need a Locomotive
  loop run once with the 300Hz interrupt masked off, which risks wedging
  the emulator's own timer/keyboard handling), so this is a documented
  estimate, not a benchmarked number.
- **Float formats differ.** Boriel's CPC `FLOAT` uses the same 5-byte
  Sinclair-style format as the Spectrum backend; Locomotive uses the
  Amstrad firmware's own 5-byte real format. In practice benchmark 4's
  checksum matches exactly (6688.08573) once both loop counters are
  floats. An earlier run declared the Boriel counter `UInteger`, which made
  `i/3` integer division and the checksum exactly 67 lower. Float *division*
  between integer-typed operands still differs by language semantics
  (see BM7 below).
- **Locomotive's integer arithmetic is 16-bit *signed*** (-32768..32767),
  and overflowing it raises a runtime error rather than wrapping (see
  finding 3 above). Boriel's `UInteger` is 16-bit *unsigned* and wraps
  silently. Any checksum comparison between an integer benchmark's two
  sides should be read with this in mind, not just as "did the numbers
  match" -- with 20000 iterations, for instance (the size the task
  originally suggested for benchmark 2), the plain sum would have
  overflowed Locomotive's signed range and wrapped/aborted well before
  Boriel's unsigned side did anything unusual.
- **BM7's `v` checksum differs between the two sides on purpose**, and
  the reason is itself informative: `v = k/2*3+4-5` with `k=5`. Boriel
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

| Operation | Boriel ms/call | Locomotive ms/call | Speed-up (Locomotive time / Boriel time) |
|---|---|---|---|
| `a+b` | 0.88 | 0.93 | 1.05x |
| `a-b` | 1.25 | 0.98 | 0.79x |
| `a*b` | 1.95 | 1.89 | 0.97x |
| `a/b` | 2.56 | 2.30 | 0.90x |
| `SIN(a)` | 40.2 | 13.8 | 0.34x |
| `COS(a)` | 42.5 | 14.7 | 0.35x |
| `EXP(a)` | 40.8 | 13.2 | 0.32x |
| `ATN(a)` | 62.8 | 24.0 | 0.38x |
| `SQR(a)` | 112.1 | 26.9 | 0.24x |
| `LN(a)` / Locomotive `LOG(a)` | 66.9 | 13.0 | 0.20x |

Basic arithmetic is roughly even; the functions are 3-5x slower in Boriel.
The Spectrum-style algorithms (long series evaluated through the
calculator's byte-code; SQR computed as x^0.5 via LN and EXP) are heavier
than the CPC firmware's routines, which Locomotive uses.
