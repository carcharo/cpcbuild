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
10. **Where the harness lives.** `cpcrun.py` and the conformance suite are
    in cpcbuild (tooling). The plan's Phase 5a CI harness (floooh/chips) and
    snapshot tests belong in zxbasic. Keep this split?
11. **cpcbuild branches.** Work is on `phase-0-1-docs` (not merged into
    `main`, not pushed). Merge to `main`, rename, or keep a long-lived dev
    branch?
12. **`#pragma zxnext=TRUE` on cpc.** It re-enables Z80N opcodes, which a
    CPC can't run (the backend only forces `zxnext` off in `init()`). Make it
    an error for `--arch cpc`?
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
