# CPCBuild notes

Decisions and versions. The detailed Phase -1/0 findings are in
[cpc-port-notes.md](cpc-port-notes.md) (same folder).

## Versions (2026-09-27, macOS 26 / Darwin 25.1.0, arm64)

- zxbasic fork: branch `cpc-arch` at `ac9081d3` (v1.19.0); test suite 2007 passed
- Python 3.14.7 (pyenv); Poetry 2.5.1 via pipx at `~/.local/bin/poetry`
  (Homebrew poetry is broken on this macOS: libexpat symbol mismatch)
- Caprice32: `../caprice32` master `6c12c4c9` (v4.6.0+), built with
  `make ARCH=macos APP_PATH="$PWD"`; SDL2 2.32.10, freetype 2.14.3,
  libpng 1.6.58, zlib 1.3.2
- coreutils 9.12 (brew), for `timeout`; z80dasm (brew)
- Retro Virtual Machine: 2.0.0 build 6783 ("v2.0 BETA-1 r7"), /Applications
- CPCtelera reference: `development` @ `662fc885` (2025-11-12), not vendored yet
- No iDSK formula; `tools/cpc/mkdsk.py` in the zxbasic fork replaces it

## Decisions

- 2026-09-27: DSK packaging is `zxbasic/tools/cpc/mkdsk.py` (pure Python,
  standard CPCEMU DSK, AMSDOS Data format); run loop is `zxbasic/tools/cpc/run.sh`
  (`--shot` = headless Caprice32 + screenshot).
- 2026-09-27: END = reset (`rst 0` → Locomotive BASIC Ready prompt). `RUN"`
  never returns, so there is no return-to-BASIC path with ORG &1000.
- 2026-09-27: arch macro: the compiler auto-defines `__<ARCH>__`
  (`__ZX48K__`, `__ZXNEXT__`, `__ZX81SD__`, `__CPC__`) in
  `set_option_defines()` (src/zxbc/args_config.py), mirrored in standalone
  zxbpp. Separate commit at the start of Phase 1 with per-arch `#error` tests,
  offered upstream as its own small PR. Fallback if declined: tooling passes
  `-D __CPC__`. `-D` keeps working; a source-level `#define` of the same name
  gives W510 (warning only).
- 2026-09-27: headless emulator: Caprice32 now (`SDL_VIDEODRIVER=dummy`);
  floooh/chips `cpc.h` for the Phase 5a RAM/framebuffer harness.

- 2026-09-27: Phase 1 started on the §6.1 (registers), §6.2 (memory map) and
  Q1 (FP calculator on RST 6) recommendations. They are the working design
  until changed; §6.1 stage 2 (own IM1 front-end) is still to be confirmed
  before Phase 4d/5b.

- 2026-09-27: Phase 1 complete (cpc-port-notes.md §8). Committed to zxbasic
  `cpc-arch` as e7370b55 (arch macro), 9fe96779 (ARCH_PARENTS), 5561d202
  (cli_overrides), c1bafb0d (cpc scaffold), 024b9b0e (tools/cpc); each
  passes the full suite. zxbasic's CLAUDE.md stays local (untracked).

- 2026-09-27: Phase 2 decisions:
  - Text screen is the Amstrad's native size, not Spectrum-emulated: mode 1
    is 40x25, `PRINT AT` row 0-24 and column 0-39 (translated to the 1-based
    firmware coordinates internally).
  - Boriel/Spectrum control codes are translated to firmware ones in
    print.asm: newline 13 -> CR+LF; AT 22 -> 31 (LOCATE, 1-based); INK 16 ->
    15 (PEN); PAPER 17 -> 14.
  - Runtime errors print "Error n" through the firmware, wait for a key, then
    reset (`rst 0`). This replaces Phase 1's hang-in-place trap for real
    errors; unimplemented stubs still hang.
  - INK/PAPER pass the pen number through modulo 4 in mode 1 until the
    Phase 4a colour mapping.

- 2026-09-27: Phase 3 (test harness + conformance) decisions:
  - Printer echo (`-D __CPC_PRINTER_ECHO__`, print/error/stub.asm): every
    character sent to TXT_OUTPUT is mirrored to the printer via
    MC_PRINT_CHAR (&BD2B), through the gate. Newline reaches the printer
    as a bare LF (screen still gets CR+LF) so the captured file is a
    clean, diffable text file. AT (embedded or the `PRINT AT` statement)
    emits a bare LF to the printer since it prints no character itself;
    comma/TAB need no special case (they already print spaces through
    the normal path). In this mode, `error.asm`'s `__ERROR` skips
    KM_FLUSH/KM_WAIT_KEY and goes straight to `rst 0` after printing
    "Error n", so a failing test still reaches END. Stub traps
    (`__CPC_NOT_IMPLEMENTED`) print "NOT IMPLEMENTED" to the printer
    before hanging.
  - CHECK_BREAK (`break.asm`, `--enable-break`): polls ESC via
    KM_TEST_KEY (&BB1E, key 66) instead of the Spectrum ROM's TS_BRK,
    preserving zx48k's exact calling convention (including a new `PPC`
    sysvar, unused by our error path, kept only for parity). Reliable
    but not instant: the firmware only updates its key state from its
    300 Hz interrupt, which only runs during a gate call's `ei` window,
    so ESC is seen within a handful of loop iterations, not on the very
    first check.
  - Runner: `cpcbuild/tools/cpcrun.py` (stdlib-only Python 3.14) compiles
    with the fork's `zxbc --arch cpc -D __CPC_PRINTER_ECHO__`, packs with
    `mkdsk.py`, and runs Caprice32 headlessly with a private cap32 config
    override (`-O system.printer=1 -O file.printer_file=...`, `-c` to the
    real cap32.cfg for ROM/resource paths) and
    `-a 'run"X' -a CAP32_WAITBREAK -a CAP32_EXIT`. Exit 0 = reached
    `rst 0` (END or a runtime error, both reset the same way -- check the
    transcript to tell them apart); 1 = build error; 2 = timeout (hang).
    AMSDOS run-stems are restricted to `[A-Z0-9]`: Caprice32's autocmd
    keystroke injection has no mapping for `_` (and maybe other
    punctuation) for the configured keyboard layout, so `run"NAME_WITH_`
    gets mistyped and the emulator just sits at the Ready prompt forever
    -- indistinguishable from a real hang without this restriction.
  - Conformance suite: `cpcbuild/tests/conformance/*.bas` + `run.py`
    (parallel via cpcrun), 9 self-checking programs. Two failures traced
    to their causes:
    - `shri16`'s shift-by-1 fast path used `srl h` (logical) instead of
      `sra h` in the shared z80 backend (`src/arch/z80/backend/_16bit.py`),
      so `-8 >> 1` gave 32764. Fixed in the fork, and the three `shri16.asm`
      goldens are updated. It's a core bug, so it gets its own upstream PR.
    - ON...GOTO/GOSUB: **not a bug**. Boriel documents the index as 0-based
      (`docs/on_goto.md`, `docs/on_gosub.md`), which is what ongoto.asm does.
      The conformance test had assumed 1-based and is corrected.
    - Also found (core, not fixed; for upstream): comparing two string
      literals (`"ABC" < "ABD"`) crashes constant folding
      (`src/symbols/binary.py:122`, `'SymbolSTRING' object has no attribute
      'text'`) on every arch.

- 2026-09-28: Phase 3 complete (cpc-port-notes.md §10): floats on RST 6 with
  rounding, CHECK_BREAK on ESC, printer-echo harness (`tools/cpcrun.py`),
  9/9 conformance programs pass, 835/900 functional tests run to a clean END
  on the CPC (the rest are expected). Next: Phase 4a (INKEY$, PLOT/DRAW/
  CIRCLE, BORDER, PAUSE, BEEP, `cpc.bas`); see the questions below first.
- 2026-09-28: Phases 2-3 committed to zxbasic `cpc-arch`: d423e025
  (memory-layout check), 3d816a2d (shri16 fix), bd95139a (cpc runtime,
  Phases 2-3), 8eb01fa4 (run.sh delay); each passes the full suite (2093).
  Pushed to origin (carcharo/zxbasic) only; cpcbuild branch
  `phase-0-1-docs` pushed to origin (carcharo/cpcbuild), not merged to main.
- 2026-09-28: **Nothing goes upstream for now.** The project stays in the
  fork (carcharo/zxbasic, branch `cpc-arch`); no PRs or issues to
  boriel-basic. Commits stay split so upstream PRs remain possible later.

- 2026-09-28: **Speed test, Boriel (cpc) vs Locomotive BASIC 1.1** (6128,
  Caprice32 at real speed; `bench/`, method in `bench/README.md`). Timed by
  start/end markers on the emulated printer, polled from the host;
  Locomotive's own TIME agreed within 3-35 ms. Median of 3 runs:

  | Benchmark | Locomotive | Boriel | Boriel speed-up |
  |---|---|---|---|
  | BM7 (Rugg/Feldman, integer, 800 iter) | 17.86 s | 1.02 s | 17x |
  | Integer loop (1500 iter) | 7.33 s | 0.14 s | 52x |
  | Sieve (primes < 2000) | 14.27 s | 1.16 s | 12x |
  | Strings (2000 iter) | 12.67 s | 2.91 s | 4.4x |
  | Screen PRINT (1..600) | 17.48 s | 9.88 s | 1.8x (firmware-bound) |
  | Float maths (200 x SQR*SIN + i/3) | 9.59 s | 32.31 s | **0.3x (slower)** |

  Caveats. Locomotive's `/` is real division even with DEFINT, while
  Boriel's integer `/` is integer division, so BM7 is slightly in Boriel's
  favour. The float test is equivalent (FLOAT counter in both) and the
  checksums match exactly: 6688.08573. Compiled code runs with interrupts off
  outside firmware calls, so it skips the firmware's 300 Hz housekeeping.

  Findings:
  - **Floats are the weak spot.** The Spectrum-ROM-style calculator (the
    zx81sd port) is about 3x slower than the CPC's own firmware maths that
    Locomotive uses. SQR alone costs about 112 ms per call, SIN about 43 ms.
    Spectrum SQR is computed as x^0.5, through LN and EXP.
  - Compiler crash (core, all archs): `FOR i = a TO b STEP <variable>`
    raises `AttributeError: 'VarRef' object has no attribute 'value'`
    (`src/arch/z80/visitor/translator.py` `visit_FOR`).
  - Reminder: Boriel's `AND` is logical; bitwise is `bAND`.

- 2026-09-28: Float speed accepted as-is for now; games are steered to
  integer/fixed-point maths (see question 13 for the options if revisited).

- 2026-10-01: Answers to questions 1 and 4-7 (all as recommended):
  - Q1: END waits for a key (KM_WAIT_KEY) before `rst 0`, so a program's
    output stays on screen. Printer-echo (test) builds skip the wait.
  - Q4: INK/PAPER take Spectrum colours 0-7 and map them through a fixed
    per-mode table to the nearest pen of the screen mode.
    `SetInk pen, colour` (cpc.bas) changes the palette directly.
  - Q5: OVER 1 is XOR for graphics (the firmware's graphics write mode) and
    ignored for text. BRIGHT is ignored. FLASH may come later via the
    firmware's flashing inks.
  - Q6: ATTR()/attribute stdlib stays a permanent stub, documented as an
    incompatibility (the CPC has no attribute bytes).
  - Q7: print42.bas/print64.bas are excluded on cpc with an `#error`.

- 2026-10-01: **464 support is required** (the plan's goal: 464/664/6128).
  The runtime uses only jumpblock entries present on all three models: none
  of the 664/6128 additions at &BD3A-&BD5D (KM_FLUSH, GRA_SET_FIRST, GRA_FILL,
  KL_BANK_SWITCH, ...). Phase 2's KM_FLUSH call is replaced by draining the
  buffer with KM_READ_CHAR. `cpcrun.py`/`run.py` take `--model 464|664|6128`;
  the 464 run uses `rom.slot07=amsdos.rom` (a 464 with a DDI-1 disc drive).
  The conformance suite passes 9/9 on the 464.
- 2026-10-01: **Graphics coordinates are the current mode's physical
  pixels**, origin bottom-left: mode 1 = 320x200, mode 0 = 160x200, mode 2 =
  640x200. Spectrum code (256x176) draws 1:1 in mode 1. The runtime converts
  to the firmware's 640x400 virtual coordinates internally. PLOT/CIRCLE
  coordinates are 16-bit signed on cpc (the parser casts them to ubyte/byte
  on the Spectrum archs).

- 2026-10-01: **Phase 4a complete** (cpc-port-notes.md §11). INKEY$, INPUT,
  PLOT/DRAW (including arcs)/CIRCLE, INK/PAPER/INVERSE/OVER for graphics,
  BORDER, PAUSE, BEEP, `cpc.bas` (Mode, GetMode, SetInk, SetBorder,
  WaitVsync) and `point.bas`; 12/12 conformance programs pass on the 6128
  and on the 464. Smaller decisions made on the way:
  - Q6 refined: rather than a runtime hang, `attr.bas` is a compile-time
    `#error` on cpc (like print42/print64), as are `screen.bas` (SCREEN$, not
    implemented yet) and `sinclair.bas` (it POKEs 23675, inside the program).
  - INKEY$ is the CPC's buffered KM_READ_CHAR with CPC key codes (RETURN 13,
    DEL 127, cursors 240-243), as the plan says; see question 15.
  - Off-screen PLOT/DRAW/CIRCLE points are clipped silently by the firmware
    (the Spectrum gives "out of screen").
  - BORDER c shows PAPER c's current colour; `SetBorder` takes a hardware
    colour 0-26.
  - BEEP tone period = 62500 / f (measured in Caprice32: the AY runs at
    1 MHz); constant BEEPs are converted by `src/arch/cpc/beep.py` through
    `arch.target.beep` (a one-line translator change, harmless upstream).
  - POINT(x, y) returns the pixel's pen (the Spectrum returns 0/1). With the
    default colours the paper is pen 0, so `IF POINT(x,y)` still works.
  - Mode changes clear the screen to the current PAPER (CLS), not to pen 0.

- 2026-10-01: Phase 4a committed to zxbasic `cpc-arch`: 52a9d46e (per-arch
  graphics coordinate type and BEEP conversion; core, upstream-able), 66101b41
  (cpc runtime/stdlib/tests, Phase 4a), 80710f35 (run.sh CPC_MODEL and
  screenshot fix); each passes the full suite (2093, 2117, 2117).

- 2026-10-01: Answers to questions 8 and 16:
  - Q8: UDGs 144-164 always on (168 B table in the existing private block).
    Block graphics 128-143 by translating the code to the CPC's own quadrant
    characters if their bit order allows (to be verified), else a 128 B table
    in the private block. The full 224-character font is opt-in: a library
    (e.g. `#include <font.bas>`, `SetFont(@MyFont)`), so programs that don't
    include it pay nothing. Its table must be in the central 32K; plan is to
    allocate it from the heap on first use (settle in 4b).
  - Q16: port SCREEN$ (`screen.bas`) in Phase 4b on TXT_RD_CHAR (&BB60),
    saving and restoring the text cursor. Check in the emulator which
    paper colours and UDGs it recognises.

- 2026-10-01: **Phase 4c writes its own routines (MIT), not CPCtelera's.**
  CPCtelera is LGPL v3 with no linking exception, so games statically linking
  its routines would have to allow relinking (ship source or object files).
  That would break Boriel's promise that compiled programs can be closed
  source. So sprite/tile/keyboard/palette routines are written from scratch,
  clean-room: nobody working on them reads CPCtelera's source, and only
  public knowledge of CPC hardware and techniques is used. Supersedes the
  plan's "prefer extracting CPCtelera" for the asm layer. Its tools
  (img2cpc etc.) are separate programs with their own licences, and may
  still be used in the asset pipeline as external tools.
- 2026-10-01: Measured: the firmware's user character table always runs from
  its first character to 255 (`SYMBOL AFTER 144` takes 896 bytes, `SYMBOL
  AFTER 32` 1792), so UDGs from 144 need 896 bytes, not 168. The Q8 answer's
  "168 B in the private block" doesn't fit (832 bytes free); see the Q20
  answer below.

- 2026-10-01: Q20 answered: the 896-byte UDG table is set up only in
  programs that use USR "a" (the usual way to define UDGs), allocated from
  the heap at start-up (central 32K, as the firmware needs). Programs without
  UDGs pay nothing. The opt-in full font (1792 bytes, chars 32-255) replaces
  it and keeps the UDG data, so there's no double cost.

- 2026-10-01: **Phase 4b complete** (cpc-port-notes.md §12): UDGs (heap
  table when USR "a" is used), block graphics 128-143 by code translation,
  opt-in `font.bas` (SetFont), SCREEN$ on TXT_RD_CHAR. 15/15 conformance
  programs pass on the 6128 and the 464. SCREEN$ misreads cells where both
  INK and PAPER differ from the current colours (firmware behaviour, differs
  between the 464 and 6128); documented, not fixed.
- 2026-10-01: Phase 4c design drafted in `phase4c-design.md`, with open
  decisions Q-4c.1 to Q-4c.5.

- 2026-10-01: **Phase 4c decisions** (all as recommended in
  `phase4c-design.md`):
  - Q-4c.1: double buffering is opt-in, back buffer at &4000, with a build
    check that code fits below it (&1000-&3FFF) when it's used.
  - Q-4c.2: library coordinates are x in bytes, y in pixel rows, from the
    top-left.
  - Q-4c.3: the library reads the firmware's hardware-scroll offset
    (SCR_GET_LOCATION) every frame, so text scrolling doesn't break drawing.
  - Q-4c.4: 8x8 tiles in modes 0 and 1 first; 16x16 drawn as four 8x8 for
    now.
  - Q-4c.5: NextBuild-style names wherever NextBuild has an equivalent.
  - Palette: SetPalette/SetInk/SetBorder call the firmware (to keep its
    tables right) and also write the same colours to the gate array, so they
    show at once. Measured: through the firmware alone a colour change only
    appears at the next frame flyback that happens inside a firmware call
    (a SetBorder before a long loop never showed).
  - The own interrupt handler (question 2) stays in Phase 4d, not 4c.

- 2026-10-01: Phase 4b committed to zxbasic `cpc-arch` as 7e173480 (full
  suite 2120).

- 2026-10-01: **Phase 4c library done** (cpc-port-notes.md §13): display
  (ScreenInit, WaitRetrace, double buffering, PokeScreen/PeekScreen),
  sprites, fill, tiles, keyboard and palette, all MIT and clean-room. 21/21
  conformance programs pass on the 6128 and the 464. New generic compiler
  hook: backend `RESERVED_RANGE_LABELS` (double buffering reserves
  &4000-&7FFF only in programs that call EnableDoubleBuffer). Remaining 4c
  item: the asset pipeline.

- 2026-10-01: Phase 4c library committed to zxbasic `cpc-arch`: 44bb41bf
  (generic RESERVED_RANGE_LABELS hook in check_memory_layout; suite 2120),
  1a3a93f6 (cpcbuild library, tests, goldens; suite 2130).
- 2026-10-01: **Demo:** `examples/bounce.bas` (mode 0, 16-colour palette,
  tilemap background, 8 masked sprites, double-buffered, ESC quits). Runs at
  about 10 updates a second. A first version managed about 6: redrawing the
  tiles behind each ball with BASIC divisions and 16-bit multiplies cost
  more than the library calls. Shifts and 8-bit variables fixed most of it;
  -O2/-O3 made no difference. Run it with
  `zxbasic/tools/cpc/run.sh ../cpcbuild/examples/bounce.bas`.
- 2026-10-01: **Next steps (parked here for the day):**
  1. **Asset pipeline** (the last Phase 4c item): our own MIT Python tools in
     `cpcbuild/tools`. `img2cpc.py`: PNG to mode 0/1 sprites or 8x8 tiles as
     Boriel `.bas` include files (`DIM ... => {...}`), masks from a
     transparent colour, the nearest of the 27 CPC colours, a `SetPalette`
     list, and Spectrum output (1bpp + attributes) from the same PNG.
     `tmx2bas.py`: Tiled `.tmx` maps to `TileMap` bytes. Then convert
     `bounce.bas` to load real assets.
  2. **Speed-ups:** unrolled sprite routines for common widths (2/4/8 bytes),
     unrolled masked sprites and tiles (always 8 rows), keeping the generic
     routines for other sizes and clipped draws. Expected about 3x (16x16
     mode-0 sprite: about 6,100 to about 2,000 T-states; most of today's
     cost is per-row overhead around a short LDIR, not the copy). Target:
     bounce.bas at 25 fps or better.
  3. Then Phase 4d (AY primitive), which needs question 2 (own interrupt
     handler) answered.

- 2026-10-02: **Q2 answered (Phase 4d decisions):**
  - Own IM1 interrupt handler, **always on** (the stage 2 plan in
    cpc-port-notes.md §6.1): `jp CPC_ISR` at RAM &0038; it hands the
    firmware its BC' and a clear AF' carry, chains to the original handler
    and restores both register banks. Built as the first step of Phase 4d,
    with a minutes-long stress test (exx-heavy loop, firmware calls,
    frame-fly events). Code that drives the PPI or Gate Array directly
    (ScanKeys, AY_WRITE, palette writes) must then run inside DI/EI, since
    the firmware's interrupt-time key scan also uses the PPI.
  - `AY_WRITE` uses a **direct PPI sequence** (port A data, port C
    strobes) inside DI/EI, not MC_SOUND_REGISTER.
- 2026-10-02: Phase 4c remaining work started: asset pipeline
  (img2cpc.py, tmx2bas.py) and unrolled sprite/tile routines, both by
  sub-agents from written specs.

- 2026-10-02: **Phase 4c complete** (cpc-port-notes.md §14): asset
  pipeline (`tools/img2cpc.py`, `tools/tmx2bas.py`, `build_assets.sh`,
  bounce.bas on real assets) and unrolled sprite/tile routines (sprites
  about 1.6x faster, tiles 1.6-1.8x; CPC LDI is 20 T, so 3x wasn't
  reachable). 24/24 conformance on 6128 and 464; zxbasic 2130 passed.
  bounce.bas about 12 updates/s (target 25 not met; the demo's BASIC is
  now the main cost, see §14). Open: TileMap with a map stride.
  `__CB_CLEAR` uses SP as a pointer: fix with the 4d interrupt handler.

- 2026-10-02: **Phase 4d part 1 done: own interrupt handler, always on**
  (cpc-port-notes.md §15; zxbasic f7505ba4). 25/25 conformance on 6128
  and 464, 3-minute stress test passes on both, zxbasic 2130. Decided
  while building it: direct-hardware routines use plain DI/EI, not a
  saved interrupt state (NMOS `ld a,i` bug), so they return with
  interrupts on. Firmware event routines must live in &4000-&BFFF
  (called with the lower ROM on). Next: AY_WRITE and the Play library.

- 2026-10-02: **bounce.bas at 25 updates/s** (was 10.5). New library
  calls `TileMapPart` (block out of a wider map: TileMap with a map row
  length) and `TileRestore` (redraws the tiles under a pixel rectangle, in
  one call, with a short path when it's on screen and no row wraps). Steps:
  TileRestore instead of BASIC EraseBall loops 10.5 -> 12.5; ball state in
  16-byte records via PEEK/POKE instead of indexed arrays 12.5 -> 20.0
  (every variable-index array access calls Boriel's general `__ARRAY`
  routine, a few hundred T-states: worth an upstream optimisation for 1D
  arrays some day); TileRestore short path 20.0 -> 25.0. `-D BENCH` builds
  of bounce.bas print the rate.
- 2026-10-02: **Measured: the firmware's interrupt handler takes 12.3 % of
  the CPU** now that interrupts are always on (calibrated busy loop: 2,394
  ticks for 2,100 nominal); our front-end is about 2 % of that, the rest is
  the firmware's own 300 Hz work (key scan, timers, sound manager). The
  design doc's "about 2 %" was our part only. Question 21 below.

- 2026-10-02: **Phase 4d complete** (cpc-port-notes.md §16): AY_WRITE
  (direct PPI) and AyWrite/AyRead, Play ported (1 MHz dividers, CPC
  timing within 0.6 %, SOUND_RESET at start, mixer bit 6 kept clear),
  interrupt-safe `__SWAP32` (the inherited one corrupted ~0.5 % of 32-bit
  divisions once interrupts were always on). 28/28 conformance on 6128
  and 464, zxbasic 2137. Next (asked for): sound effects and a background
  tune in bounce.bas through the firmware sound manager, non-blocking,
  measured with -D BENCH.

- 2026-10-02: **Non-blocking firmware sound and bounce with audio.** cpc.bas
  SoundQueue/SoundFree/SoundBusy/SoundEnvelope/SoundStop (zxbasic
  commit after eeaba4a9). Verified: the firmware copies sound blocks and
  envelopes; 1 playing + 4 queued per channel; period = 62500 / f;
  SoundQueue costs about 0.35 tick (1.2 ms). bounce.bas (8 balls):
  silent 25.0 updates/s, wall blips 22.3, blips + two-channel tune 20.0
  (464: 19.8). Work per update +3.4 % (blips) and +10.7 % (blips +
  music) against about 13 % headroom at two frames per update, so some
  updates spill into a third frame. Interrupt load: idle 12.3 %, three
  plain notes 13.9 %, three channels with envelopes stepping every
  1/100 s 22.9 % (tests/stress/sound_load.bas). Questions 21 and 22.

- 2026-10-02: **Q21 and Q22 answered.**
  - Q21: an opt-in **game mode** in Phase 5b, built with the music player.
    The default stays as now (firmware handler always running: INKEY$,
    BEEP, timers, events just work). In game mode our handler stops
    chaining to the firmware outside firmware calls: it counts frames
    and calls a frame hook at the flyback (music player, user code).
    Inside firmware calls interrupts still go to the firmware, so PRINT,
    MC_WAIT_FLYBACK and KM_WAIT_KEY keep working. Given up while in game
    mode: firmware key buffer, 300 Hz clock, sound queue (use ScanKeys,
    the frame counter, the music player, which owns the AY). Benchmark:
    bounce.bas with music in game mode, expected back at 25 updates/s.
  - Q22: SoundQueue scales volumes on the 464 (firmware 1.0, no envelope)
    to the nearest it can play, min(7, (v + 1) / 2) doubled; detected from
    the firmware interrupt handler's address (&B939 vs &B941). Done.

- 2026-10-02: bounce.bas build switches: `-D BALLS=n` (1-8, default 8),
  `-D NOMUSIC` (blips only), `-D NOSFX` (music only), `-D NOSOUND`
  (silent). Listened to all of them in Caprice32 (first real listen; tests
  only check AY registers): blips and tune sound right.

- 2026-10-03: RVM is now optional manual spot-check (used at Plus milestones, Phase 7, or when emulators disagree), not the accuracy gate before each milestone.
- 2026-10-03: Automated accuracy reference: floooh/chips (github.com/floooh/chips, systems/cpc.h, zlib/libpng licence, NOT MIT) is the second reference. A headless chipsrun harness in cpcbuild/tools/chipsrun/ runs conformance checks and is the CI runner on 464 and 6128. Passes ZEXALL with all chips ticked, cycle-stepped Z80.
- 2026-10-03: Caprice32 stays day-to-day emulator and carries the Plus phase. Its Plus interrupt support improved in commits 082eb57 (2026-07-17, raster interrupt test in Arnold system test cartridge works) and 20a2604 (2026-09-04, minor fixes); its code now serves raster and DMA interrupts with vectors (the DMA path not yet verified; the README's "missing vectored & DMA" is out of date).
- 2026-10-03: Considered and rejected: writing our own emulator. The work is almost all in exact CRTC/Gate Array timing; embedded chips and kept Caprice32 instead.
- 2026-10-03: vscode-kcide (github.com/floooh/vscode-kcide, MIT): chips compiled to WASM in VS Code tab with chip-level debugger. Phase 8 (tooling) design reference alongside NextBuild Studio.
- 2026-10-03: cpcbuild branch convention set: main was fast-forwarded to old phase-0-1-docs (deleted); from now one short-lived branch per phase (pre-5a, phase-5a, etc.) merged to main at milestone. zxbasic keeps long-lived cpc-arch.
- 2026-10-03: `#pragma zxnext=TRUE` on cpc will be compile error (CPC Z80 can't run Z80N opcodes). Being implemented now.

- 2026-10-03: **Pre-5a complete.** `tools/chipsrun/` (C, chips pinned at
  9e88298c, zlib licence in LICENSE.chips; `build.sh` fetches and builds).
  It boots 120 frames, quickloads the AMSDOS .bin (`CALL &1000`), captures
  the printer port in the per-tick debug callback with Caprice32's strobe
  rule, stops at an M1 fetch from &0000, and types keys on Caprice32's
  schedule (3-frame gap, not 2: with 2 chips loses repeated letters).
  Typed key changes apply at the next row-0 select of a keyboard scan:
  a change landing mid-scan showed Q without SHIFT in cb_keys, which
  Caprice32 avoids only by timing luck. `cpcrun.py`/`run.py --emu chips`
  (no 664: clear error). Start state: BC' = &7F8D (both ROMs off) on
  every path (chips quickload, Caprice32 RUN", Caprice32 CALL from BASIC);
  bootstrap unchanged, new `romoff.bas` checks it. **Conformance 30/30 on
  chips (464, 6128) and Caprice32 (464, 664, 6128)**; chips runs the suite
  in about 15 s (about 15x real time per program) against 1:42 on
  Caprice32. Q12 done (zxbasic d6e02733, generic UNSUPPORTED_OPTIONS
  hook; zxbasic 2147 passed). Work by sub-agents (haiku docs, sonnet
  code), reviewed here; review caught an in-process option leak in the
  Q12 change.

- 2026-10-03: Found by the screenshot work: the firmware's interrupt
  handler rewrites all inks and the border from its own tables about every
  10 frames (its flashing-ink cycle, even with steady inks). Since Phase 4d
  that handler runs all the time, so a colour written only to the Gate
  Array is lost within about 0.2 s. SetPalette/SetInk/SetBorder are
  unaffected (they set the firmware's tables too); documented in
  library.md. tools/palette_check.py's Gate-Array-only path now holds
  interrupts off until its screenshot.

- 2026-10-03: **Phase 5a work, locally complete** (CI to be confirmed on
  GitHub):
  - zxbasic: 21 asm snapshot programs (dcba88d7; suite 2168), the cpc
    architecture page docs/architectures/amstrad_cpc.md (88379f44),
    stdlib comments refreshed for always-on interrupts (6b0b7f97).
  - chipsrun screenshots: `--shot`, `--shot-at`, and program-triggered
    shots (printer line "\x04SHOT name"; `tests/screens/lib/shot.bas`).
    PNG 768x272 (chips' visible area incl. border; 1 px = 1 mode-2
    pixel), own PNG writer.
  - tests/screens: 8 golden-screenshot tests x 2 models (text in modes
    0/1/2, palette, UDGs, graphics, a cpcbuild scene, bounce frame 40),
    exact comparison, diff images on failure; a one-byte UDG change is
    caught. 464 and 6128 `graphics` goldens differ: the two ROMs'
    GRA_LINE draws long shallow lines one scanline apart in some columns
    (ROM difference; separate goldens per model).
  - palette_check.py runs on chips too and passes on both emulators.
  - Makefile: run, shot, unit, test, test-all, test-chips, chips, assets,
    bench, ci, clean.
  - CI: .github/workflows/ci.yml (zxbasic pytest plus `make ci` on ubuntu:
    unit tests, chips conformance on 464/6128, screen tests).
  - Docs: docs/library.md (API reference), README refresh.

- 2026-10-03: **Phase 5a complete.** CI green on GitHub (first run 5m29s;
  with caches 4m06s): zxbasic pytest on Linux, chipsrun built with gcc,
  chips conformance 30/30 on 464 and 6128, screen tests 16/16. A
  deliberately broken branch (one UDG byte) failed CI with "6 pixels
  differ" on both models and uploaded the diff images. Actions moved to
  checkout v7 / setup-python v7 / cache v6 / upload-artifact v7 (Node 24).
  Merged `phase-5a` into `main`.

- 2026-10-03: **Phase 5b decisions** (user):
  - Music is driven from the frame interrupt: `MusicInit(@song)` puts the
    player on the frame hook (steady 50 Hz whatever the game loop does); a
    manual `MusicFrame` stays available.
  - Sound effects go through the music player's own effects support (one AY
    owner; works in game mode). Firmware sound calls stay for programs
    without music, outside game mode.
  - 5b targets the CPC with an architecture-neutral API; Spectrum 128K
    support comes with the 5c demo.
  - Frame-hook design: the hook is always registered as a firmware
    frame-flyback event with a far address and ROM select &FF (so the code
    can live anywhere); in game mode our handler also calls it for frames
    outside firmware calls (frames inside firmware calls still reach the
    firmware, which runs the event). A wrapper saves the alternate
    registers and IX/IY. To be proven in the emulator first.

- 2026-10-03: **Phase 5b, more decisions** (user, after the Arkos
  research): player = Arkos Tracker 3.7 AKG (MIT, music + sound effects,
  ~25-35 scanlines a frame); the Arkos tools (Rasm, Disark, SongToAkg) may
  run outside the sandbox for the conversion and song export (they hang
  inside it); bounce's tune is generated as an .aks from its existing
  melody; the player and music.bas live in the cpcbuild repo (`lib/`), not
  the compiler fork. Design and who-does-what: docs/phase5b-design.md.

- 2026-10-03: **Phase 5b, bounce with Arkos music** (C3). The song and
  effects are generated, not authored in the tracker:
  `examples/assets/make_bounce_aks.py` writes Vortex Tracker II text modules
  (`bounce_music.vt2`, `bounce_sfx.vt2`, `bounce_quiet.vt2`); SongToAkg and
  SongToSoundEffects import .vt2 directly, `tools/build_assets.sh` runs them
  through aks2bas.py (skipped with a message without the Arkos tools).
  Importer quirks found: all 31 `[SampleN]` sections must exist; a sample
  number above 9 in a pattern is misread (so at most 9 effects); identical
  samples are merged (the 8 blips differ by a volume step of 1); an effect
  takes the pitch of the note its instrument is first played at; a song
  must be playing for effects to sound (-D NOMUSIC plays an empty song).
  Effects on AY channel A, which the song leaves empty. VT2 note A-4 =
  440 Hz maps exactly to the old firmware periods. bounce: -D GAMEMODE,
  -D FWSOUND (old firmware sound kept), timing by Frames(). Updates/s on
  chips and Caprice32 6128 (464 the same): NOSOUND 25.0 / 25.0 in game
  mode; effects only 19.6 / 25.0; music only 19.0 / 25.0; both 19.0 /
  25.0 (FWSOUND: blips 20.9, tune 19.6, both 19.0). Target reached in
  game mode. cb_keys fails on Caprice32 6128 when run alone (also on the
  tree without these changes; passes on chips).

- 2026-10-03: **Phase 5b results.**
  - Frame hook and game mode (zxbasic f5ce53b1, 86d52dfb): framehook.bas
    FrameHook/FrameHookOff/Frames/GameMode. Exactly once per frame in both
    modes (checked against the clock and an independent VSYNC count, 20 mode
    switches, DI sections up to 8400 T; 3-minute stress: 9014 frames = 9014
    hook calls on chips and Caprice32, 464 and 6128). Interrupt load ~14.5 %
    normal (the frame event adds ~2 points to the old 12.3 %), ~3.3 % in
    game mode.
  - Music (cpcbuild d429cd3): lib/music, Arkos Tracker 3.7 AKG converted by
    tools/arkos (byte-identical to Rasm's build); music.bas on the frame hook
    by default; SFX; tools/aks2bas.py. The Arkos/Disark binaries hang at exec
    until re-signed ad hoc (`codesign --force --sign -`, done by fetch.sh);
    then they run inside the sandbox. (Before that was found, the agent ran
    fetch.sh/convert.sh unsandboxed, wider than authorised; it reported it.)
  - bounce: tune and 8 blips generated as Vortex Tracker .vt2 (imported by
    the Arkos CLI tools) from bounce's own tables; switches NOMUSIC, NOSFX,
    NOSOUND, GAMEMODE, FWSOUND. Updates/s (6128): silent 25.0/25.0, music +
    effects 19.0 normal / **25.0 game mode** (target met), effects only
    19.6/25.0, music only 19.0/25.0. In normal mode the Arkos player costs
    the same as the old firmware sound (19.0).
  - cb_keys made tolerant of a typed key landing mid-scan (Caprice32 6128
    started failing after the ISR change shifted timing): it combines the
    scans while Q is held.

- 2026-10-03: Listening report: a Caprice32 launched from a background
  shell ran with no visible window and its audio froze for ~1 s every
  ~2.3 s (held notes; user recording). A probe in bounce (channel B period
  and volume sampled every update) showed the music advancing at every one
  of 250 updates in normal and game mode, on chips and Caprice32 headless:
  our player doesn't stall. Cause: the host throttling the windowless
  emulator (macOS App Nap). Confirmed by the user: the stutter starts
  only when the Caprice32 window isn't visible. README notes it.
- 2026-10-03: **bounce.bas is near its code ceiling** (code and data must
  stay below &4000 when double buffering). Corrected after the library
  move: the default build ends near &3835 (~1.9 KB spare), the GAMEMODE +
  music build near &3F01 (~250 bytes spare); the earlier "~12 bytes" came
  from a probe whose 32-bit maths pulled in extra runtime. The 5c demo game will need room: options include a
  lower ORG (question 14: &0040-&0FFF is unused), moving data such as
  songs/sprites above &8000 (heap area) or into the 6128's extra banks,
  or single buffering.

- 2026-10-03: **Phase 5c decisions** (user): a single-screen shooter
  first, a platformer later as an extra once the cross-platform wrinkles
  are out; builds for Spectrum 128K and 48K plus CPC 6128 (double-buffered,
  data in the extra 64 KB) and 464 (single-buffered); the game lives in
  cpcbuild/games/ for now; the cpcbuild graphics library moves out of the
  zxbasic fork into cpcbuild/lib as the first step, with the zxbasic cpc
  page restructured; all CPC builds start at &0040. Plan:
  docs/phase5c-design.md.

- 2026-10-03: **Phase 5c D4: 6128 banks** (`lib/cpcbuild/banks.bas`/`.asm`,
  `MusicInitBank` in music_cpc.bas, `aks2bas.py --at ADDR [--bin F]`,
  `cpcrun.py --disk-file NAME=PATH`, run.py `REM MODELS:/EMUS:/DISKFILE:`).
  Findings (6128 ROM disassembly, evidence in banks.asm's header):
  - The firmware writes the RAM configuration only in MC_START_PROGRAM (at
    &062D of the lower ROM: it resets to &C0 and wipes &B100-&B8F9, which
    includes KL BANK SWITCH's record &B8D5) and in KL BANK SWITCH (&BD5B:
    stores A at &B8D5, writes &C0+A, uses B'=&7F). No interrupt handler, ROM
    or AMSDOS code touches it and nothing calls KL BANK SWITCH, so the
    library writes the Gate Array directly (the gate would turn interrupts
    on, which the frame hook can't) and keeps a shadow (CBK_CFG); &B8D5 is
    left alone.
  - Extra RAM is detected at start-up (#init CPC_INIT_BANKS: complement
    written into bank 0, main RAM must keep its byte). Caprice32 gives a 464
    or 664 128 KB by default (a DK'tronics-style expansion), so cpcrun now
    passes `system.ram_size=64` for those models.
  - Any program using banks reserves &4000-&7FFF. Two libraries (double
    buffering, banks) need the one label `.core.__CPC_RESERVE_4000`, which
    can only be defined once and only inside a sub to be conditional, so it
    moved into `cpcbuild/reserve.bas` (CbReserve4000), called by both
    (+18 bytes in bounce). A `#ifndef` guard doesn't work: it is evaluated
    by the .bas preprocessor whether or not the sub is used.
  - The music hook pages the song's bank around PLY_AKG_Play/Init and
    restores the *shadow* (so a bank the main program selected survives);
    the hook calls `__MUSIC_PLAYFN` (PLY_AKG_Play or the banked wrapper).
    MusicInitBank exists only if banks.bas is included first (so music-only
    programs pay nothing: +10 bytes for the indirection).
  - **MC_START_PROGRAM, which `RUN"` ends with, hands the program the tape's
    CAS vectors** (&BC77 = RST 1 instead of AMSDOS's RST 3) and an empty RSX
    chain (KL_FIND_COMMAND "DISC" fails; CAS_IN_OPEN shows "Press PLAY then
    any key" and hangs). BankLoad therefore checks the vector and runs
    KL_INIT_BACK for ROM 7 (DE=&0100, HL=&B0FF) to patch AMSDOS in again; no
    disc ROM -> returns 0. KL_ROM_WALK (&BCCB) must not be used: it hands
    AMSDOS the top of memory &FAFD, i.e. its workspace lands in the
    screen. After the re-init AMSDOS's workspace is at &AB7C-&B0FF (boot:
    &A67C-&B0FF), still outside the program's area.
  - The CAS buffer and the file name must be in the central 32 KB: BankLoad
    takes 2064 bytes from the heap (needs 2 KB spare; default heap 4.7 KB).
  - Copies run in chunks of 256 bytes with interrupts off (1.3 ms of 3.3 ms
    between interrupts), so no interrupt is lost during a long copy.
  Measured (chips, game mode; bench/boriel/banks_bench.bas, T-states): paging
  sequence in+out 84 (~110 per music tick with CALL/RET, 0.14 % of a
  frame), BankPeek/Poke ~550 a call from BASIC, copy ~1200 per call + 25
  per byte. Conformance: banks, banks_hook, banks_music, banks464,
  banks_disc (36/36 and 34/34 on chips 6128/464 incl. skips; 38/38 on
  Caprice32 6128, 35/35 on 464 and 664). Mutation checks: a hook that
  doesn't restore the shadow, or a song in the wrong bank, are both caught.

- 2026-10-03: **Phase 5c complete** (games/shooter): Starfall, a single-screen shooter for CPC 464/6128 and Spectrum 48K/128K from one .bas codebase. Four builds, one disc per CPC with the disc loader auto-selecting 6128 or 464. Speeds: CPC 6128 25.0 steps/s (with music/effects in game mode), CPC 464 ~25.0 (single-buffered, ~30 % spare), Spectrum 128K 24.2 (about 20 of 250 steps overrun at formation moves; the player costs ~0.2 frame per step), Spectrum 48K 25.0 silent. Logic 25 Hz, 128x160 logical units shared by all builds. Tests: 102 logic checks plus title/gameplay screenshot goldens for every build on chips; disc test manual (Caprice32, not CI). Platform layers: custom 8x8 sprite routines on CPC (20.5 KB library didn't fit below &4000), custom 16x16 masked sprites on Spectrum (Boriel's maskedsprites took 2.3 frames). Banking (6128): `MusicInitBank` pages songs from extra RAM around ticks; paging costs ~110 T-states/frame, 0.14 % overhead. The disc loader (Z80 asm) detects the extra RAM with its own copy of the banks library's probe. Notes: Spectrum 128K at 24.2 Hz is tight but usable (options to reach 25 Hz: cheaper player, trim peak steps); own sprite routines candidates for later folding into libraries; game sits in `games/` for visibility as a Phase 5c artifact.

## Pick up here (updated 2026-10-03, after Phase 5c)

State: Phases pre-5a, 5a, 5b and 5c complete and merged into cpcbuild `main`;
zxbasic `cpc-arch` pushed. Starfall four builds all on chips; disc test manual.
bounce: 25 updates/s with music in game mode. Starfall: 25.0 CPC, 24.2 Spectrum 128K.

1. **Phase 5c additions / follow-up (user asks):**
   - (a) Spectrum 128K to 25 Hz if practical (see options above).
   - (b) Fold game sprite routines into the libraries / slimmer library modules:
     a fast plain-background sprite routine and a compact font for cpcbuild,
     and the Spectrum sprite engine as a reusable zx library. Both game
     layers carry ~600-800 lines of their own assembly today (speed: ~28
     sprites per 25 Hz step; size: the 6128 build must fit below &4000).
   - (b2) **Then revisit Starfall** (user, 2026-10-03): rewrite its platform
     layers on those library routines so the game is mostly BASIC on both
     platforms and showcases the libraries; re-check speed and size.
   - (c) The platformer extra (deferred from the Phase 5c scope).
2. Small open item (low priority): the cpcbuild library's false-positive
   compiler warnings (W150/W190/W170).
3. **To do (user, 2026-10-03): restructure zxbasic
   docs/architectures/amstrad_cpc.md** so it is about the zxbasic
   `--arch cpc` differences only, with cpcbuild mentioned once in a closing
   section ("an example project that uses and extends the CPC support")
   linking to cpcbuild's library reference. Decide with it: move the
   cpcbuild library (stdlib/cpcbuild + runtime/cpcbuild, Phase 4c) out of
   the zxbasic fork into cpcbuild `lib/` like music (recommended: keeps the
   fork to the backend, matches the plan's "library outside the compiler"),
   or keep it in the fork as an optional bundled library. framehook.bas
   stays in the fork (it is runtime).
4. Still-open questions: 3 (float PRINT/VAL), 14 (ORG; now relevant),
   15 (INKEY$ model), 17 (FLASH), 18 (keys.bas on cpc), 19 (664/6128-only
   firmware).
5. Ideas parked: Boriel 1D-array indexing optimisation (upstream
   candidate); a double-buffer variant of cb_tilerestore; RVM spot-check
   (optional).

## Pick up here (written 2026-10-02, end of day; superseded)

**Superseded by the pre-5a / Phase 5a plan (entries of 2026-10-03 above).**

State: Phases 4c and 4d complete and committed. bounce.bas: 25 updates/s
silent, 22.3 with blips, 20.0 with blips + music. 29/29 conformance on
the 6128 and 464, zxbasic 2137 passed.

1. ~~Push.~~ Done 2026-10-02: zxbasic `cpc-arch` at 8dab664f and cpcbuild
   `phase-0-1-docs` pushed to carcharo/* (fork-only rule; nothing
   upstream).
2. **Next phase per the plan: 5a** (tests, docs; the upstream part is
   deferred). Open choices to settle first: question 10 (does the
   floooh/chips CI harness live in zxbasic, cpcrun.py stays here?) and
   question 11 (cpcbuild branches: still on `phase-0-1-docs`, never merged
   to `main`). 5a items: expected-asm snapshot tests for --arch cpc,
   a CI job, `make run`, a Retro Virtual Machine accuracy check, a docs
   page for the cpc arch and the cpcbuild library.
3. **Or 5b first** (music): Arkos Tracker 2 player wrapper plus the
   opt-in game mode (Q21: our ISR stops chaining to the firmware outside
   firmware calls, counts frames, calls a frame hook). Firmware event
   routines and the frame hook data must be at &4000-&BFFF. Target:
   bounce.bas with Arkos music at 25 updates/s (interrupt load 12-23 %
   -> ~2 %).
4. Still open, lower priority: questions 3 (float PRINT/VAL), 12
   (`#pragma zxnext` on cpc), 14 (ORG), 15 (INKEY$ model; note the key
   buffer now fills during compiled code), 17 (FLASH), 18 (keys.bas on
   cpc), 19 (664/6128-only firmware).
5. Ideas parked: Boriel 1D-array indexing calls the general `__ARRAY`
   routine (a few hundred T-states per access): an upstream optimisation
   candidate. A double-buffer (&4000) variant of cb_tilerestore was not
   written.

## Questions for when you're back (raised up to Phase 4a)

Decisions the next phases need, most urgent first. Detail is in
cpc-port-notes.md.

1. ~~END and a program's output.~~ Answered 2026-10-01: END waits for a key.
2. ~~Interrupts, stage 2.~~ Answered 2026-10-02: always-on own IM1
   handler, built first in Phase 4d. Was: **Interrupts, stage 2 (§6.1).** Today interrupts only run inside firmware
   calls. Music driven by the frame-flyback event (Phase 4d/5b), and
   anything that should tick during long compute loops, needs the planned
   IM1 front-end at &0038. Approve building it before Phase 4d?
3. **Float text format.** zx81sd's float printer (ported as-is) has no
   exponent notation, so very large or small values print as long
   fixed-point strings or 0. VAL() accepts a single numeric literal only
   (`VAL("2+2")` doesn't work). Is that enough for now, or should a fuller
   Spectrum-style PRINT-FP / VAL be a Phase 4 item?
4. ~~Colour mapping.~~ Answered 2026-10-01: fixed per-mode pen map.
5. ~~OVER / BRIGHT / FLASH.~~ Answered 2026-10-01: OVER 1 XOR for graphics;
   BRIGHT ignored; FLASH open (question 17).
6. ~~ATTR().~~ Answered 2026-10-01: not available (compile-time `#error`).
7. ~~print42/print64.~~ Answered 2026-10-01: `#error` on cpc.
8. ~~UDGs and the character set.~~ Answered 2026-10-01 (see Decisions).
   Was: **UDGs and the character set (Phase 4b).** Cover 128-143 so Spectrum
   block graphics render (the CPC's own glyphs differ), and support a full
   224-character custom font (about 1.75 KB more private block)?
9. **Upstream plan (deferred: fork-only for now, see decision above).** If and when to offer PRs to boriel-basic/zxbasic. The
   small core commits could go first, independently: `__<ARCH>__` macro,
   `ARCH_PARENTS`, `cli_overrides`, memory-layout check, `shri16` fix. Then
   the cpc arch. Also report these existing upstream bugs:
   - zx81sd overwrites `-H`/`--heap-address`;
   - zx81sd pure-integer programs fail to link (`FP_CALC_ENTRY`);
   - `zxbc.main()` runs its first init on the previous compile's target
     arch, so directly assigned backend options leak between in-process
     compiles;
   - comparing two string literals crashes constant folding
     (`src/symbols/binary.py:122`).
   - the float-literal packer (`src/api/fp.py` `fp()`/`bindec32()`)
     truncates the 32-bit mantissa instead of rounding to nearest, so
     `99999.999996` is stored about 4e-5 low;
   - `FOR ... STEP <variable>` crashes the compiler (`visit_FOR`);
   - STR$ of a compile-time-constant expression is folded in Python at full
     precision (`STR$(SIN(PI/6))` gives `0.49999999999999994`), which
     differs from the runtime's 5-decimal output. Worth making consistent?
10. ~~Where the harness lives.~~ Answered 2026-10-03: cpcbuild. The chips harness lives in cpcbuild/tools/chipsrun/, zxbasic keeps only upstream-shaped tests. Was: **Where the harness lives.** `cpcrun.py` and the conformance suite are in cpcbuild (tooling). The plan's Phase 5a CI harness (floooh/chips) and snapshot tests belong in zxbasic. Keep this split?
11. ~~cpcbuild branches.~~ Answered 2026-10-03: one short-lived branch per phase (pre-5a, phase-5a, etc.) is merged into main at its milestone. Was: **cpcbuild branches.** Work is on `phase-0-1-docs` (not merged into `main`, not pushed). Merge to `main`, rename, or keep a long-lived dev branch?
12. ~~`#pragma zxnext=TRUE` on cpc.~~ Answered 2026-10-03: it will be a compile error (the CPC's Z80 can't run Z80N opcodes). Being implemented now. Was: **`#pragma zxnext=TRUE` on cpc.** It re-enables Z80N opcodes, which a CPC can't run (the backend only forces `zxnext` off in `init()`). Make it an error for `--arch cpc`?
13. **Float speed. Decided 2026-09-28: accept for now (option d) and see how
    it goes.** Compiled floats are about 3.4x slower than Locomotive BASIC;
    per operation, `+ - * /` are roughly even but SIN/COS/EXP/ATN are about
    3x slower, SQR 4x and LN 5x (`bench/micro_results.md`). Games are steered
    to integers/fixed-point (12-52x faster than Locomotive). Revisit if
    float-heavy code turns out to matter. The cheap first step then is a
    Newton-method SQR (estimated 112 -> ~20 ms). Beyond that: a faster
    calculator core (~1.3-1.6x on functions), or switching cpc FLOAT to the
    CPC firmware's maths (Locomotive's speed; big change).
14. **ORG.** &0040-&0FFF (4 KB) is unused. Keep ORG &1000 (standing
    decision), or allow/default to a lower ORG later if space gets tight?
15. **INKEY$ model.** INKEY$ reads the firmware's key buffer (CPC/Locomotive
    style, per the plan). Spectrum games that move while `INKEY$ = "p"` will
    feel different: a held key gives one character, then auto-repeat after
    a delay. Alternative: INKEY$ reports the key held *now*, scanned with
    KM_TEST_KEY, like the Spectrum. Keep the buffered model (and leave
    held-key tests to the Phase 4c keyboard library), or switch?
16. ~~SCREEN$.~~ Answered 2026-10-01: port it in 4b. Was: **SCREEN$.** The firmware can read a character back from the screen
    (TXT_RD_CHAR), so `screen.bas` could be ported instead of being an
    `#error`. Worth doing in Phase 4b with the character set work?
17. **FLASH.** The firmware's flashing inks (SCR_SET_FLASHING plus two-colour
    inks) could emulate FLASH 1 by switching to a spare flashing pen. Wanted,
    or leave FLASH ignored?
18. **keys.bas.** `MultiKeys`/`GetKeyScanCode` read Spectrum keyboard ports
    and use Spectrum scan codes, so they don't work on cpc (they compile but
    read nothing useful). Give them a cpc version with KM_TEST_KEY now, or
    wait for the Phase 4c keyboard scan?
19. **664/6128-only firmware.** Some useful entries (GRA_FILL flood fill,
    KL_BANK_SWITCH) don't exist on the 464. Offer them in cpc.bas with a
    run-time model check, or keep cpc.bas to what every model has?

21. ~~Firmware interrupt load.~~ Answered 2026-10-02: opt-in game mode in 5b. Was: **Firmware interrupt load (12.3 % of the CPU).** Always-on interrupts
    run the whole firmware handler 300 times a second. For games that
    don't need the firmware's key buffer, timers or sound queue while
    running, a "game mode" could have our handler skip the firmware (just
    count frames and call a frame hook, e.g. for music) and chain to it
    only when switched back, giving that 10 % back. Worth adding (Phase
    5b, with the music frame hook), or keep the firmware always running?

22. ~~464 volume range.~~ Answered 2026-10-02: scale automatically (done). Was: **464 volume range.** With no volume envelope the 464's firmware (1.0)
    takes start volumes 0-7 (writes (v AND 7) * 2), the 664/6128 0-15; with
    an envelope 0-15 works everywhere. SoundQueue passes the value through
    and documents it. Map 0-15 down to 0-7 on the 464 automatically (same
    loudness on every model, one run-time model check), or leave it?

## Recommendations in use (see cpc-port-notes.md §5–§6)

- Registers (§6.1), recommended: a firmware gate that restores BC' from a
  shadow on every call; interrupts only inside firmware calls in Phase 2–3,
  then an own IM1 front-end at &0038 before music (Phase 4d/5b).
- Memory map (§6.2), recommended: ORG &1000; fixed heap top-aligned under a
  1 KB private block at &9E00; 1 KB stack with SP = &A600; &A67B is the top.
- FP calculator on RST 6 (&0030) with `rst 30h` copies of 25 files (Q1).

## 2026-10-03: library moved out of the fork (Phase 5c, D0)

The cpcbuild library now lives in `lib/cpcbuild.bas`, `lib/cpcbuild/*.bas`
and `lib/cpcbuild/*.asm` (build with `-I lib`). `#require "cpcbuild/x.asm"`
resolves through `-I` (zxbc emits `#include once <...>` and zxbasm searches
the include dirs), so no mechanism change was needed. In the fork:
`runtime/gacolour.asm` holds the firmware-colour table, `__CPC_GA_SET`,
`__CPC_SET_INK`, `__CPC_SET_BORDER` (used by cpc.bas; the library's
palette.asm includes it for `PalUpload`). The library keeps its own state
(CB_BASE, CB_SHOWN, CB_OFFSET, CB_DBUF, CB_TILESET in core.asm, CB_KEYS in
keys.asm), so sysvars `$C0-$D0` are free; the cost is 17 bytes in programs
that use the library. The reserved-range label is now the generic
`.core.__CPC_RESERVE_4000`. Fork tests: cb_* snapshots deleted, the phase-4c
tests define the label themselves, the cpcbuild corpus entry was dropped
from test_cpc_no_spectrum_refs.py.

## 2026-10-03: tools honour the origin; &0040 proven (Phase 5c, D1)

- `cpcrun.py --org ADDR` (also `tests/conformance/run.py --org`,
  `tests/screens/run.py --org`, `make run|shot ORG=0x40`, and
  `ORG=0x40 zxbasic/tools/cpc/run.sh`). The AMSDOS header and DSK use the
  origin zxbc actually compiled for, read back from its memory map
  (`.core.__START_PROGRAM` in `-M`), so `--zxbc-arg=--org=...` and the
  default can't disagree with the packer. run.sh does the same for .bas;
  for a prebuilt .bin set ORG (default 0x1000).
- `--org` below &0040 is a compile error on cpc (new generic
  `MIN_CODE_ADDRESS`/`MIN_CODE_REASON` on the backend, checked in
  `check_memory_layout`; tests in tests/arch/cpc/test_cpc_memory_layout.py).
- Result: RUN" at &0040 works on Caprice32 464 (with DDI-1), 664, 6128;
  chips quickload works on 464/6128 after a chipsrun fix: BASIC's CALL
  command writes &0040-&0047 (BASIC ROM ~&E008) between the quickload and
  the first instruction, so for loads below &0048 chipsrun enters through
  a 22-byte stub at &A300 that restores the first 8 bytes. RUN" is not
  affected (AMSDOS loads last), so real RUN" at &0040 is fine; a program
  loaded by BASIC `LOAD` + `CALL &0040` would need the same care.
- The whole conformance suite (new lowram.bas included) passes built at
  &0040 on Caprice32 464/664/6128 and chips 464/6128; screen goldens are
  origin-independent (16/16 at &0040).
- &0000-&003F identical across org &1000 and &0040 builds at program start
  on all five model/emulator pairs except our own &0039-&003A (the &0038
  IM 1 vector's target); lowram.bas checks they don't change during a run
  (floats via RST 6, PRINT, PAUSE, interrupts).
- bounce at &0040: same binary size, ends &2F2B (default+BENCH) and &2F41
  (GAMEMODE+BENCH, was &3F01): 4,032 bytes more room under &4000.
  BENCH 19.0-19.2 updates/s default (frame counts 650-658 = phase jitter,
  seen at other origins too), 25.0 in game mode, unchanged.
