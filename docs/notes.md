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

- 2026-10-03: **Open questions answered** (user, all as recommended):
  - Q3 float text: PRINT/STR$ get Spectrum-style exponent notation for large
    and small values; VAL stays single-literal (documented).
  - Q14 ORG: the default becomes &0040 for --arch cpc (proven on all models
    and both emulators; RUN" unaffected by the LOAD+CALL &0040 caveat).
  - Q15 INKEY$: Spectrum semantics, the key held now (keyboard matrix +
    the firmware's key translation table); INPUT stays buffered; a -D switch
    keeps the old buffered INKEY$.
  - Q17 FLASH: stays ignored (documented).
  - Q18 keys.bas: a cpc keys.bas in the fork's stdlib with the zx48k API and
    key constants mapped onto the CPC matrix (own scan, no cpcbuild
    dependency), so ported Spectrum code works unchanged.
  - Q19 664/6128-only firmware: cpc.bas keeps to the common set; banking is
    cpcbuild's banks library; GRA_FILL later in cpcbuild with a model check
    if needed.

- 2026-10-03: **Phase 6 decisions** (user): bare-metal mode with full API
  parity except disc (LOAD/SAVE/BankLoad/firmware sound are compile errors);
  chosen by a compile-time switch (a run-time `FirmwareOff()` switch is noted
  as an alternative to revisit if feedback prefers it); proven by bare builds of Starfall CPC
  (6128 and 464) against the firmware builds; designed for no-firmware
  cartridge boot (Phase 7). The plan's 6128 bank helpers are already done
  (banks library, 5c). Design and who-does-what: docs/phase6-design.md.

- 2026-10-03: **Q15 (INKEY$ = key held now) and Q18 (cpc keys.bas) implemented**
  (zxbasic: runtime/io/keyboard/kscan.asm, inkey.asm, stdlib/keys.bas,
  input.bas; not committed yet when written).
  - One shared scan, `__CPC_KSCAN_ROWS` (D = first row, E = count): PPI/AY
    matrix read with plain di/ei, PPI restored (as cpcbuild's `__CB_SCAN_KEYS`,
    which stays separate: no dependency either way). `__CPC_KEYS` holds the
    last scan, bit = 1 pressed.
  - INKEY$ (`__CPC_KEYHELD`): first held key in matrix order (row 0 bit 0
    first) that yields a character; SHIFT (key 21) and CONTROL (23) are
    modifiers, joystick row 9 bits 0-6 ignored, DEL (79) kept. Translation
    (`__CPC_KEYCHAR`, B = key, E = modifiers) through the firmware: CONTROL
    table if CONTROL held, else SHIFT table if SHIFT held or shift lock on,
    else normal; entries &FD/&FE/&FF = no key; &80-&9F expansion tokens give
    the first character of the token's string via KM_GET_EXPAND (default
    keypad: digits, ".", RETURN); everything else as is (ESC 252, COPY 224,
    cursors 240-243). Caps lock turns a-z into A-Z whatever SHIFT says.
  - **Firmware entries (the brief had two wrong):** KM_GET_STATE &BB21 (L =
    shift lock, H = caps lock), KM_GET_TRANSLATE &BB2A, KM_GET_SHIFT **&BB30**
    (&BB2D is KM_SET_SHIFT), KM_GET_CONTROL **&BB36** (&BB30 is GET_SHIFT),
    KM_GET_EXPAND &BB12. Tables are identical on 464 and 6128 (probed).
    KM_SET_LOCKS (&BD3A, H = caps, L = shift lock) and KM_FLUSH (&BD3D)
    exist on the 664/6128 only (inkey_locks.bas is MODELS 664 6128).
    Calling KM_SET_LOCKS while keys were being typed hung chips once: set
    locks only when idle.
  - Observed firmware behaviour used: shift lock + SHIFT stays shifted (no
    inversion); caps lock + SHIFT + letter stays upper case.
  - `-D CPC_INKEY_BUFFERED` keeps the KM_READ_CHAR INKEY$ exactly. INPUT
    flushes the firmware buffer at its start (`__CPC_FLUSH_KEYS`).
  - keys.bas: zx48k API and names; value = (row << 8) | bit mask; KEYCAPS =
    SHIFT, KEYSYMBOL = CONTROL (aliases KEYSHIFT, KEYCONTROL), KEYENTER =
    RETURN; CPC-only names listed in the file header. MultiKeys with a row
    above 9 (a Spectrum constant) returns 0.
  - Tests: conformance inkey.bas, inkey_locks.bas, keys_cpc.bas, keys_port.bas
    (same source also compiles with --arch zx48k); keyboard.bas now builds with
    `REM ZXBC: -D CPC_INKEY_BUFFERED` (new run.py directive); cb_keys.bas reads
    the firmware buffer with KM_READ_CHAR. Caveat for test authors: a typed key
    is held ~2 frames, so slow work (STR$, CHK) between a poll and the next
    poll can miss it.

## Pick up here (updated 2026-10-04: Phase 6 complete, CI split)

State: Phase 6 done and merged into cpcbuild `main` (zxbasic `cpc-arch`
ff7acf4e); CI restructured into five parallel jobs (~5 min, docs-only
pushes skipped, superseded runs cancelled, nightly run gated on recent
zxbasic commits); main green (4:44).

Next:
1. Check the first nightly run (cron 03:23 UTC, `gate` job): it should
   run the suite only if zxbasic cpc-arch had a commit in the last 25 h.
2. Then Phase 7 (CPC Plus / ASIC library; Caprice32 + CPCEC, see the plan),
   or the earlier follow-ups first (Spectrum 128K Starfall to 25 Hz; fold
   the game routines into the libraries, then revisit Starfall; the
   platformer; W150/W190/W170 warnings). R8 (CPCEC as WASM in VS Code,
   GPLv3) comes after Phase 7; the platformer tutorial after Phase 8.

## Pick up here (2026-10-03, end of day: Phase 6 stage gate passed; superseded)

State: Phase 6 B0-B4 done on cpcbuild `phase-6` (5f376eb) and zxbasic
`cpc-arch` (3335b40c), both pushed; CI green on phase-6 (14 min now). The
stage gate passed (see "Phase 6 stage gate passed" below). Stopped there
for the user, as agreed. Next: B5, B6, B7 (docs/phase6-design.md).

**B5, bare graphics (sonnet):** PLOT, DRAW, CIRCLE, POINT, OVER without the
firmware (graphics.asm etc. still call GRA_* through the gate).
- First: add `make test-bare` to `make ci` and .github/workflows/ci.yml
  (about 10 more minutes per CI run) so bare mode can't regress silently.
- Remove the temporary markers: `grep -rn "until Phase 6 B5" tests/` (5
  files: conformance font, udg, screen, graphics; screens/graphics).
- Bare variants for cb_display, cb_fill, cb_sprites, cb_tiles,
  cb_tilerestore (skipped bare today because the *tests* use the firmware
  clock, SCR_GET_LOCATION or GRA_TEST_ABSOLUTE as references): time with
  tests/conformance/lib/ticks.bas, compare against bare POINT, offset 0;
  cb_tilerestore's "m1 real scroll offset is 0" check needs a bare meaning
  (bare text scrolls in software, the CRTC offset is always 0).
- Keep bare graphics pixel-identical to firmware mode (screens/graphics
  golden, both models, disc and cold start).

**B6, Starfall bare builds (sonnet):** 6128 and 464.
- No disc in bare mode (BankLoad refused): a firmware-mode loader loads
  the data/banks, then starts the bare program.
- Size: a bare program carries ~3 KB more (boot, text code, 1.8 KB glyph
  table): bare `PRINT "Hello"` 4651 bytes vs 1619. error.asm pulls in
  txtbare.asm, so every bare program that can raise an error carries the
  text code and font even if it never PRINTs. Starfall draws its own text:
  look at making the error screen output optional/lighter, or -D
  CPC_OWNFONT, before judging headroom. Bare code may go up to &B800 (vs
  &9E00), but the 6128 build must still keep &4000-&7FFF for the back
  screen.
- Compare speed with the firmware builds (25.0 steps/s on both); try
  fitting the full cpcbuild library in the 6128 build.
- Double buffering bare: `__CB_SET_BASE` writes CRTC R12/R13 and points
  SCREEN_ADDR at the shown screen.

**B7, docs (haiku):** zxbasic docs/architectures/amstrad_cpc.md (bare mode:
switch, memory map, what's refused and why, cold start / CPC_OWNFONT),
cpcbuild docs/library.md (bare notes per call), README status. Check the
figures against notes.md (doc agents have invented numbers before).

**Choices to confirm with the user (made during B3/B4):** PAUSE bare ends
on a *new* key press (firmware mode: a buffered key); bare INPUT shows an
underscore cursor; the run-time FirmwareOff() alternative to the
compile-time switch is still only noted (design doc).

**For Phase 7 (cartridge):** the runtime keeps state in the program image
(Boriel's way; kbare.asm's locks, INPUT's repeat state ...), so a
cartridge build must copy the program to RAM before running it; cold
starts need -D CPC_OWNFONT (the lower ROM may not be the CPC firmware);
chipsrun --cold is the rehearsal (junk RAM, ROMs out, CRTC unprogrammed).

**Agent hygiene:** an agent ran `git stash`/`pop` in cpcbuild while others
had uncommitted work (nothing lost). Tell agents never to run git stash,
checkout, reset or clean, and give each its own scratchpad subfolder (B1
and B2 collided on generic scratch file names).

Earlier follow-ups still open: see the next section (Starfall 128K to 25 Hz,
fold the game's sprite/font routines into the libraries then revisit
Starfall, the platformer, W150/W190/W170 warnings, parked ideas).

## Pick up here (2026-10-03, after Phase 5c; Phase 6 items superseded above)

State: Phases pre-5a, 5a, 5b and 5c (the shooter) complete and merged into
cpcbuild `main`; zxbasic `cpc-arch` pushed; CI green (conformance, screens,
Spectrum tests, Starfall's four builds). Starfall played by the user on all
four builds (sound fixed: audible in-game loop, 48K beeper effects).
Speeds: CPC 6128/464 25.0, Spectrum 48K 25.0, 128K 24.2 steps/s.
Next per the plan: Phase 6 (bare-metal mode), 7 (CPC Plus), 8 (tooling);
or the follow-ups below first.

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
3. ~~Restructure the zxbasic cpc page; move the cpcbuild library out of the
   fork.~~ Done 2026-10-03 (zxbasic b1872f72, 10370615; cpcbuild 7cff646).
4. ~~Still-open questions~~ All answered 2026-10-03 (see the entry above).
   To implement: Q3 (exponent notation), Q14 (default &0040); Q15 (INKEY$
   held key) and Q18 (cpc keys.bas) done 2026-10-03.
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
3. ~~Float text format.~~ Answered 2026-10-03: exponent notation in PRINT/STR$; VAL literal-only. Was: **Float text format.** zx81sd's float printer (ported as-is) has no
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
14. ~~ORG.~~ Answered 2026-10-03: default &0040. Was: **ORG.** &0040-&0FFF (4 KB) is unused. Keep ORG &1000 (standing
    decision), or allow/default to a lower ORG later if space gets tight?
15. ~~INKEY$ model.~~ Answered 2026-10-03: key held now (Spectrum). Was: **INKEY$ model.** INKEY$ reads the firmware's key buffer (CPC/Locomotive
    style, per the plan). Spectrum games that move while `INKEY$ = "p"` will
    feel different: a held key gives one character, then auto-repeat after
    a delay. Alternative: INKEY$ reports the key held *now*, scanned with
    KM_TEST_KEY, like the Spectrum. Keep the buffered model (and leave
    held-key tests to the Phase 4c keyboard library), or switch?
16. ~~SCREEN$.~~ Answered 2026-10-01: port it in 4b. Was: **SCREEN$.** The firmware can read a character back from the screen
    (TXT_RD_CHAR), so `screen.bas` could be ported instead of being an
    `#error`. Worth doing in Phase 4b with the character set work?
17. ~~FLASH.~~ Answered 2026-10-03: stays ignored. Was: **FLASH.** The firmware's flashing inks (SCR_SET_FLASHING plus two-colour
    inks) could emulate FLASH 1 by switching to a spare flashing pen. Wanted,
    or leave FLASH ignored?
18. ~~keys.bas.~~ Answered 2026-10-03: a cpc keys.bas on the CPC matrix. Was: **keys.bas.** `MultiKeys`/`GetKeyScanCode` read Spectrum keyboard ports
    and use Spectrum scan codes, so they don't work on cpc (they compile but
    read nothing useful). Give them a cpc version with KM_TEST_KEY now, or
    wait for the Phase 4c keyboard scan?
19. ~~664/6128-only firmware.~~ Answered 2026-10-03: common set only. Was: **664/6128-only firmware.** Some useful entries (GRA_FILL flood fill,
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

- 2026-10-03: **Default ORG is now &0040** (zxbasic cpc backend `_ORG`, mkdsk/run.sh
  defaults, bench.py pack; Q14 revised). cpc goldens regenerated (21). banks464.bas no
  longer needs `--org=0x40`. bounce GAMEMODE+BENCH: 12,051 bytes, ends &2F52, 4,269 bytes
  below &4000; 25.0 updates/s on chips 6128. Caprice32 keeps running a few instructions
  after the address-0 breakpoint (RAM at 0), which can print junk after the END marker
  at low origins; cpcrun.py now drops everything from the marker on.

## 2026-10-03: Phase 6 B0, bare-metal switch, memory map, boot (zxbasic 14af9259)

- `-D CPC_BAREMETAL` selects bare-metal mode at compile time (design:
  docs/phase6-design.md; the run-time `FirmwareOff()` alternative is noted
  there to revisit if feedback prefers it, so bare entry points stay the
  same as firmware-mode ones).
- Bare memory map (backend `_layout()`): code+data+heap from &0040 up to
  &B800, stack &B800-&BBFF (top &BC00), private block &BC00-&BFFF, screen
  &C000. The firmware map is unchanged (private &9E00, stack top &A600).
  A 45,000-byte array that fails in firmware mode builds bare.
- runtime/bareboot.asm replaces the firmware start-up: di, IM 1, both ROMs
  off, private block zeroed and our &0038 handler installed *first* (the
  palette helper ends with EI; installing later hung chips 6128 in the
  firmware's handler), RAM config &C0, PPI, CRTC 0-13, AY silent, sysvar
  defaults, mode 1, firmware default inks, screen cleared, EI. Works after
  RUN" and is written for a cold start (no firmware ever ran).
- Bare interrupt handler: every interrupt goes to the frame detector
  (framecore.asm, split out of framehook.asm): FH_FRAMES counts frames and
  the frame hook runs once per frame; GameMode() has no effect.
- Firmware calls refuse to build bare: the gate `__FW_CALL` isn't defined,
  so any firmware call is an undefined label (tests/arch/cpc/
  test_cpc_baremetal.py, 7 tests). kscan's firmware translation, the frame
  event registration and error.asm's TXT_OUTPUT are firmware-mode only.
- END bare: echo builds send the END marker via the printer port
  (`__CPC_PRN_CHAR`) and reset; otherwise wait for a key and reset (lower
  ROM in, RST 0).
- Verified: bare smoke programs (POKE, 50 frames) exit 0 on chips 464/6128
  and Caprice32 464/664/6128; firmware mode unchanged (chips 42/42 6128,
  39/39 464, Caprice32 6128 43/43, Starfall 6/6, screens 16/16); zxbasic
  pytest 2175 passed.
- Next: B1 harness (`--bare`, chipsrun `--cold`), B2 text, B3 keyboard,
  B4 sound/timing, then the stage gate (whole suite bare).

## Phase 6 B1: bare test harness (2026-10-03)

- `tools/cpcrun.py --bare` adds `-D CPC_BAREMETAL`; `--cold` (chips only,
  needs `--bare`) = chipsrun `--cold`: no firmware at all. RAM (all 8 banks)
  is filled with an xorshift junk pattern, both ROMs are paged out (GA
  config &0C), the image is written at its load address and the CPU starts at
  the entry with interrupts off, IM 0, SP &C000. Power-on state otherwise is
  what chips gives after `cpc_init`: Gate Array mode 0, pens and border all
  hardware colour 0, RAM config 0; CRTC registers all 0 (so no display or
  interrupts until the boot programs them); PPI all inputs; AY registers 0.
  The cold run takes the same typed-key schedule as a normal run (from
  program start). Printer capture, END detection, shots all work as before.
- chipsrun `--end-on-marker` (cpcrun/run.py `--end-on-marker`, opt-in): the
  run ends when the END marker line is captured, instead of waiting for the
  M1 fetch at address 0. B1 found that **bareboot's `__CPC_RESET` paged the
  lower ROM in and then executed `rst 0` from code below &4000**, so the
  next fetch came from ROM at that address (chips 464: ROM code ran, address
  0 never fetched; Caprice32 464/664 hung on some programs). Fixed in the
  runtime: the last three instructions are copied to the private block
  (&BC00) and run there. Bare runs again require the reset to address 0.
- chipsrun `--trace` also prints PC/SP/IFF1/GA config at a timeout; the
  program-triggered `"\x04STATE\n"` line makes chipsrun print the Gate Array
  mode, ROM bits, RAM config, pen/border registers and CRTC R0-R13 to
  stderr (`chipsrun-state:`), checked by `REM STATE: key=value ...` in a test.
- conformance `run.py --bare/--cold/--end-on-marker`; `REM BARE: skip <reason>`
  (firmware-only tests) and `REM BARE: only` (bare tests, written with
  `tests/conformance/lib/bareout.bas` instead of PRINT/CHK). `make test-bare`
  (not in `ci`): chips 6128 and 464 bare, chips 6128 cold.

## Phase 6 B2: bare text (2026-10-03)

- `runtime/txtbare.asm` (only under `-D CPC_BAREMETAL`): glyph renderer, cursor,
  CLS, scroll, Mode, SCREEN$ read-back. print.asm, cls.asm, sposn.asm,
  copy_attr.asm, error.asm (`__ERR_SCR`), border.asm, gacolour.asm, udg.asm and
  cpc.bas (`Mode`, `GetMode`), font.bas (`SetFont`), screen.bas have `#ifdef`
  bare paths; firmware builds are unchanged.
- Drawing: `Mp ^ (S & (Mi ^ Mp))` per screen byte, where S is the glyph bits
  spread over the byte's pixels and Mi/Mp are the ink/paper pens as byte masks
  (`__BT_PENMASKS`, recomputed at each COPY_ATTR/INK_TMP/INVERSE_TMP). Mode 1/0
  look the byte up in a 16/4-entry table (`BT_TBL`), mode 2 uses two registers.
  A cell is written whole (no transparency); OVER/BOLD/ITALIC/FLASH/BRIGHT
  ignored for text, as in firmware mode. Bare text is pixel-identical to
  firmware text with the ROM font (screen goldens mode0/1/2text, udg: 0 pixels
  differ, 464 and 6128).
- Cursor and wrap behave like the firmware's: lazy wrap (column = TXT_COLS is a
  pending wrap) and **lazy scroll** (an LF on row 24 only moves the cursor to
  row 25, so CSRLIN reads 25; the next character scrolls first). Software
  scroll: eight 1920-byte block moves with unrolled LDI, about 3 frames per
  scroll (the firmware's hardware scroll is free; not used so the screen base
  stays fixed for graphics and libraries).
- Font: the glyph table (chars 32-255, 1792 bytes, 8-byte aligned, in the program
  image) is filled at start-up (`CPC_INIT_10_TEXT`) by a 25-byte routine copied
  to the private block (`BT_TRAMP`) that pages the lower ROM in (interrupts
  off) and copies &3900-&3FFF. `-D CPC_OWNFONT` instead bundles our own MIT font
  for 32-127 (the data is the table: no copy, no ROM) with UDG 144-164 = A-U
  and 165-255 blank. 128-143 are generated, in the Spectrum's numbering (no swap
  anywhere). CHARS = table - 256, UDG = glyph 144 as on the Spectrum, so
  `POKE USR "a"+n` and `SetFont` just work and the UDGs need no heap; in bare
  mode USR "a" is anywhere in RAM (the central-32K assertions in udg.bas and
  font.bas are bare-aware).
- SCREEN$ (`__BT_RDCHAR`) decodes the cell into pens (at most two) and matches
  the glyph table from char 32 up, then the inverted glyph; it reads cells in
  any colours back correctly (the firmware misreads PAPER 2 + INK 4; screen.bas
  has a bare variant of that check).
- Sysvars added at `$100-$13F`, `$140-$17F`, `$200-$20F` and `PAL_SHADOW` at
  `$C0` (colour of each pen, written by `__CPC_GA_SET`, so BORDER can use the
  pen's colour without SCR_GET_INK).
- New test `tests/conformance/text.bas` (both modes): pixel bytes in modes 0/1/2,
  INVERSE/PAPER/INK, wrap, lazy scroll, TAB/comma, CLS, SCREEN$ round trip of
  ASCII, `__ERR_SCR`. It assumes the ROM font.
- Still needs other bare pieces: font.bas, udg.bas, screen.bas, graphics.bas
  (POINT/PLOT: B5), framehook.bas (fhlib calls the firmware).

## Phase 6 B3: bare keyboard (2026-10-03)

- Key tables (zxbasic runtime/io/keyboard/kbare.asm): normal/SHIFT/CONTROL,
  80 bytes each, taken from the firmware's own KM_GET_TRANSLATE/SHIFT/
  CONTROL (dump program tools/keytables_dump.bas; 464 and 6128 identical).
  Keypad expansion tokens resolved to their default strings' first
  character. tests/conformance/keytables.bas checks all 240 entries in both
  modes (no differences).
- Caps lock / shift lock: kept in kbare.asm (`__CPC_KB_LOCKS`, a byte in
  the program image), toggled when a scan sees CAPS LOCK go down (CONTROL
  held: shift lock). A press between two scans is missed; keys.bas's own
  scans don't track locks.
- INPUT bare: same BASIC loop, keys from `__CPC_KEY_NEXT` (edge detection
  on the key number; repeat after 30 frames then every 4, on FH_FRAMES),
  underscore cursor (no firmware cursor), `__CPC_KEY_FLUSH` ignores a key
  already down at the start until it is released.
- `-D CPC_INKEY_BUFFERED` with `-D CPC_BAREMETAL` is an `#error`.
- Phase 7 note: like the rest of the runtime, this keeps state in the
  program image, so a cartridge build must run from RAM (copy the code
  out of ROM first).

## Phase 6 B4: bare sound and timing (2026-10-03)

- BEEP on the AY (tone A, volume 15, whole frames on FH_FRAMES, starts at a
  frame boundary), PAUSE n on frames (ends on a *new* key press: edge
  detection, closer to the Spectrum than the firmware's buffered key),
  WaitVsync = next frame (runtime waitframes.asm). Play and MusicInit's
  SoundStop silence the AY directly (`__CPC_AY_SILENCE`, bare only).
- Refused in bare mode: SoundQueue/SoundFree/SoundBusy/SoundEnvelope and
  cpcbuild BankLoad build to an undefined label named
  `..._needs_the_firmware__not_available_with_CPC_BAREMETAL` (only when
  used; a file-level #error would fire for every program including cpc.bas).
  Play's benchmark mode is an #error.
- cpcbuild: `__CB_SET_BASE` writes CRTC R12/R13 directly in bare mode and
  points SCREEN_ADDR at the shown screen (bare PRINT follows the flip like
  the firmware's); `__CB_SYNC` uses offset 0 (bare text scrolls in
  software); WaitRetrace on frames. Palette was already Gate Array only.
- Tests: bare_sound.bas, cb_bare_display.bas (bare only); play, music,
  music_hook, textio run in both modes through tests/conformance/lib/
  ticks.bas (`Frames()*6` bare), music.bas's SoundQueue checks firmware
  only, textio's border check reads PAL_SHADOW bare and its BEEP period
  from AY registers 0/1.

## Phase 6 stage gate passed (2026-10-03)

The whole conformance suite, bar firmware-only tests, passes built bare,
every run ending with the reset to address 0:

| Run | Result |
|---|---|
| chips 6128, disc start / cold start | 32/32 / 32/32 |
| chips 464, disc start / cold start | 29/29 / 29/29 |
| Caprice32 464 / 664 / 6128 | 29/29 / 29/29 / 32/32 |
| screens bare, disc start / cold (464+6128) | 14/14 / 14/14, pixel-identical to the firmware goldens |

Firmware mode unchanged (`make ci`: unit 69, chips 45/45 and 42/42,
screens 16/16, zx 29/29, Starfall 6/6 + 14/14; zxbasic pytest 2175).

Skipped bare (`REM BARE: skip`), by design (firmware-only): banks_disc,
banks464 (AMSDOS), cb_keys, keyboard (firmware key buffer), inkey_locks
(KM_SET_LOCKS), cb_palette (firmware ink tables), isr, framehook (firmware
clock/event; bareframes.bas is the bare counterpart), romoff (FW_BC),
sound (firmware sound manager). Waiting on B5 (bare graphics): font, udg,
screen, graphics (+ screens/graphics), and cb_display, cb_fill,
cb_sprites, cb_tiles, cb_tilerestore (POINT/graphics references and
firmware-clock timing in the tests: bare variants due in B5).

## 2026-10-03: CPCEC is the second Plus emulator (Phase 7)

- Decision (user): test Phase 7 against **CPCEC** as well as Caprice32
  (chips has no Plus). Details and reasons in PLAN-boriel-cpc.md Phase 7.
  Arnold (rofl0r/arnold) and WinAPE not used.
- Built and ran `-h` on macOS (Homebrew SDL2 2.32.10) from the cpcitor
  mirror at release 20260303 in a scratch dir, nothing added to the repos.
  Note `-I/opt/homebrew/include`: its source includes `<SDL2/SDL.h>`, which
  `sdl2-config --cflags` doesn't cover.
- Patching for our use case is fine: GPLv3 lets us modify it freely. It
  stays a separate program run as a subprocess, so our own code is
  unaffected. cpcbuild is a public repo, so a patch committed there is
  distributed: keep it a GPLv3 patch file plus a fetch script pinned to an
  upstream commit (tools/cpcec/, with the licence noted), not a vendored
  copy mixed into our tools.

## 2026-10-04: two additions to the plan (user)

- Research task R8 before Phase 8: CPCEC compiled to WASM as the in-VS Code
  emulator, and what GPLv3 means for shipping it in a `.vsix` (aggregation
  vs combined work, source duties, asking CPCEC's author). See the plan,
  end of Phase 8.
- After Phase 8: the platformer becomes a tutorial that teaches the tools by
  following it. See the plan.

## Phase 6 B5: bare graphics (2026-10-04)

- runtime/gfxbare.asm (new, included by gfx.asm in bare mode): PLOT, DRAW
  (incl. the arc form via draw3.asm), CIRCLE, POINT, OVER straight into
  screen memory, every pixel clipped to the screen; pixel write
  `byte ^ (((byte & KEEP) ^ I) & Pm)` (KEEP $FF = replace, 0 = OVER 1/XOR);
  screen base from SCREEN_ADDR (follows the cpcbuild double buffer); the
  graphics cursor is in the program image. Uses only the txtbare.asm core,
  so a graphics-only bare program is 2684 bytes (no glyph table).
- **The 464 and the 664/6128 firmwares draw different lines** (GRA_LINE
  disassembled from both ROMs; the screens goldens for 464 and 6128 differ):
  464 = run lengths from a division (Q or Q+1), 664/6128 = an error-term
  loop (rounded Bresenham runs). Bare mode has both: CPC_INIT_12_GFX looks
  for the 464's GRA_MOVE_ABSOLUTE target (&15F4) in the RAM jumpblock at
  &BBC0 (intact on a disc start), anything else (664/6128, cold start's
  junk) gets the 664/6128 algorithm; `-D CPC_LINE_464` / `-D CPC_LINE_6128`
  force one (cpcrun adds CPC_LINE_464 for `--cold --model 464`). Checked
  with 120 + 250 random lines per mode (clipped, OVER, INVERSE, circles,
  arcs): 0 pixels differ from firmware on 464 and 6128, disc and cold.
- break.asm bare: ESC from the matrix (row 8 bit 2), same calling
  convention (ESC-down path untested: chipsrun can't type ESC).
- Tests: the five "until B5" skips removed; cb_display, cb_fill,
  cb_sprites, cb_tiles, cb_tilerestore run bare (lib/ticks.bas,
  lib/scrolloff.bas: ScrollOffset() = SCR_GET_LOCATION, 0 bare); checks
  that only mean something with the firmware's hardware scroll are
  firmware-only (#ifndef CPC_BAREMETAL), firmware names and counts kept.
- Results: chips bare and cold 41/41 (6128), 38/38 (464); Caprice32 bare
  41/41 and 38/38; screens --bare/--cold 16/16, pixel-identical.

## Phase 6 B6: Starfall bare builds (2026-10-04)

- build_cpc.sh also builds starbare.bin (6128) and starba64.bin (464) from
  the same source with `-D CPC_BAREMETAL`. On the disc: `RUN"DISC` starts
  the firmware builds as before; `RUN"BARE` (BARE.BIN = loader_bare.asm,
  which is loader.asm with BARE defined) stages STARFALL.DAT at &9000,
  copies it into extra bank 0, then loads and starts the bare build. The
  bare PlatInit checks BankAvailable() and the song data's "AT" signature
  (BankLoad is refused bare); no songs = silent game. build_cpc.sh fails
  if STARFALL.DAT would run past &A5FF (firmware/AMSDOS workspace).
- **txtbare.asm split** (bare text): txtbare.asm is now the ~0.8 KB core
  (mode variables, pen tables, clear, cell address, CR, __BT_DRAW), the new
  txtglyph.asm holds the 1.8 KB glyph table, LF/scroll, __BT_PUTC and
  SCREEN$. print.asm/udg.asm/font.bas/screen.bas use txtglyph; Mode, CLS,
  AT, colours and graphics only the core. error.asm draws "Error n" with a
  14-glyph mini font (~200 bytes) unless the program has the glyph table
  (then `__BT_PUTC_VEC`, set by txtglyph's init, gives PRINT's output). The
  mini-font path has no wrap or scroll (overwrites row 24). Before the
  split the bare 6128 Starfall ended at &434E (over &4000).
- Sizes: 6128 firmware 14760 bytes (ends &39E8, 1560 free below &4000),
  6128 bare 15214 (&3BAE, 1106 free); 464 firmware 14513, 464 bare 15177.
  A bare program that PRINTs carries the font again (Starfall + PRINT would
  end near &4700).
- Speed: 25.0 steps/s for every build (chips 6128/464 bare; Caprice32 bare
  6128 from RUN"BARE with music from the bank: 501 frames for 250 steps).
  Bare benchmarks report through `-D BENCH_ERR` ("Error n", n = frames -
  400) because a PRINT would not fit (`BARE=1 tests/bench.sh chips`).
- Full cpcbuild library in the 6128 bare build: does not fit (ends &4A45,
  2629 bytes over; firmware equivalent &47AC, 1964 over); the library costs
  ~3.7 KB. In the 464 bare build it fits with ~28 KB to spare below &B800.
- Tests: games/shooter/tests/run.py `--variant fw|bare|cold` (default all):
  logic 102 checks and title/play shots pass bare and cold, pixel-identical
  to the firmware goldens; tests/disc.py covers RUN"BARE (12/12 on
  Caprice32).

## 2026-10-04: Phase 6 complete

- User played the bare Starfall builds from the disc (`RUN"BARE`) on
  Caprice32: 6128 (songs from bank 0) and 464 (songs in the program, as in
  the firmware 464 build), music and effects on both: all fine.
- Confirmed (user): bare PAUSE ends on a new key press (no key buffer; a key
  held when PAUSE starts doesn't end it); bare INPUT's underscore cursor;
  keep the compile-time switch `-D CPC_BAREMETAL` for now (the run-time
  FirmwareOff() alternative stays noted in docs/phase6-design.md).
- Merged phase-6 into main (fast-forward), zxbasic cpc-arch at ff7acf4e.

CI restructured (pre-7-ci): parallel jobs, nightly gate, docs-only pushes skip CI.

## 2026-10-04: Phase 7 decisions (user)

- Plus/ASIC library in cpcbuild `lib/cpcplus/`.
- Raster interrupts (PRI) in bare mode only: a non-zero PRI suppresses the
  CPC's normal six interrupts per frame (Caprice32 crtc.cpp), which the
  firmware depends on. Everything else in both modes.
- Proof: Starfall Plus (hardware sprites, 12-bit palette) as a `.cpr`
  cartridge and on disc for the 6128 Plus, plus a Plus feature demo.
- CI: build Caprice32 headless for the Plus tests.
- Design and steps: docs/phase7-design.md (stage gate before the proof).

## 2026-10-04: test cartridges; CPC-POWER policy

- Amstrad's Arnold 5 Diagnostic ROM v1.3 (.cpr CRC32 0b01af8c) downloaded by
  hand by the user into tools/arnold/ (git-ignored; Amstrad's copyright,
  never commit). It is interactive.
- Also in tools/arnold/ (tools/fetch_test_carts.sh): llopis/amstrad-
  diagnostics v1.3 (MIT; RAM, ROMs, keyboard, CRTC: a cartridge-boot check,
  not ASIC) and Roudoudou's Plus test cartridges (atboot, dma, split,
  sprites, stress).
- **CPC-POWER (cpc-power.com) is anti-AI:** it won't host software generated
  or partly generated by AI, and its downloads are behind a CAPTCHA. Never
  fetch from it automatically, and never submit CPCBuild output there.

## Phase 7 P2: Plus library core (2026-10-04)

- lib/cpcplus/ (cpcplus.bas, plus.asm, plusgfx.asm): PlusAvailable/Unlock/
  Lock/PageIn/PageOut; SetPalette12, SetBorder12, GetPalette12,
  SetPalette12Block (entries 0-15 pens, 16 border, 17-31 sprite colours);
  SpritePalette, SpriteColour, SpriteSetImage(+Packed), SpriteMove (X in
  mode-2 pixels, Y in lines), SpriteMag (0 off, 1, 2, 4), SpriteHide,
  SpritesHideAll. Every call auto-unlocks; a no-op on a CPC without ASIC.
  About 0.5 KB.
- Verified (Caprice32 asic.cpp/cap32.cpp, CPCEC cpcec.c, the Plus firmware;
  cpcwiki returned 403): unlock `FF 00 FF 77 B3 51 A8 D4 62 39 9C 46 2B 15 8A
  CD EE` to &BC00 (CPCEC unlocks on CD, Caprice32 wants the byte after);
  lock = first 15 bytes + not CD. RMR2 (&7Fxx, bits 7-5 = 101, only when
  unlocked): bits 4-3 = 11 page the registers at &4000-&7FFF, &A0 restores
  (lower ROM page 0; no other RMR2 shadow kept). Unlock is sent with
  interrupts off (firmware flyback events select CRTC R12/R13).
- **Firmware palette refresh:** the firmware's ticker (block &B7F9, routine
  &0D61; same in 6128 and Plus ROMs) writes all 17 inks to the Gate Array
  every 10 frames; the ASIC turns them into 12-bit values, so 12-bit colours
  were lost within a second. Pen/border palette writes unlink that block
  from the ticker chain (DI, guard: &B7FF holds &0D61). Flashing inks then
  freeze; firmware ink tables, PRINT and SetInk still work. `Mode()` restarts
  the ticker and resets inks: set the 12-bit palette again after Mode.
  Sprite colours are never touched by the firmware.
- **&4000 window:** every call reserves &4000-&7FFF (CbReserve4000), so all
  code and data sit below &4000 and paging happens in short DI windows
  (interrupt state restored). This limits Plus programs to ~16 KB below
  &4000: to be lifted in P3 (paged access from outside the window).
- Probe on a non-Plus: one RMR write with the current mode, both ROMs off,
  so nothing changes except a reset of the Gate Array interrupt counter
  (one interrupt may be delayed) and the CRTC register select.
- Sprites survive a soft reset (END): call SpritesHideAll() before END.
- Tests: plus_core/palette/sprites/hook/asset (Plus, both modes),
  plus_none/none_hi/none_state (464/664/6128, chips incl. cold); screens
  plus_sprites, plus_palette12 (Plus golden; 464/6128 goldens show "NO
  PLUS"); make test-plus green (51/51, 46/46, screens 10/10 x2).

## Phase 7 P3: paged access, scroll/split, raster interrupts, DMA (2026-10-04)

- **16 KB limit lifted:** the code that runs while the ASIC page is in is a
  58-byte trampoline copied at start-up (CPC_INIT_PLUS) into the private
  block (PL_TRAMP +&300, PL_BUF +&340: a 64-byte bounce buffer for data that
  itself lies in &4000-&7FFF), so the library and its data may sit anywhere.
  Interrupts off for one byte (~0.1 ms) or one 256-byte picture (~1.4 ms).
  Only PlusPageIn/PlusPageOut (they hand the page to the program) still
  reserve &4000-&7FFF. New PlusPeek/PlusPoke. ~+370 bytes.
- ScrollFine(dx 0-15 mode-2 pixels, dy 0-7 lines; clamped), ScrollBorder,
  SplitScreen(line, addr) / SplitScreenCrtc / SplitOff (both modes).
- **Raster interrupts (bare only):** RasterIntAt/Off/Clear; plusraster.asm
  patches the bare ISR's JP at &0039; sorted table of up to 15 user lines +
  a frame entry at line 243 that runs __CPC_FH_RUN (Frames, PAUSE, BEEP and
  the frame hook stay at 50 Hz); PRI 0 and the ordinary ISR when the table
  is empty. IM 1 needs no DCSR acknowledge in either emulator. END clears it
  through the new CPC_EXIT_VEC hook in bare __CPC_RESET (zxbasic
  bareboot.asm/sysvars.asm). Firmware builds using them fail with an
  undefined label `RasterIntAt_needs_bare_mode__build_with_D_CPC_BAREMETAL`.
  Handlers must not change the table. The frame line (243) assumes the
  standard CRTC R4/R7.
- **DMA sound (both modes):** DmaStart/Stop/Active/Prescaler/Align and list
  macros (LOAD, PAUSE, REPEAT, NOP, LOOP, INT, STOP). Lists anywhere in the
  first 64 KB at an even address (DMA reads RAM, not the ASIC page). AY
  ownership rules as for the music player.
- **Caprice32 quirks (not fixed, emulator side):** with the ASIC page out it
  writes the DMA address/prescaler/DCSR registers into RAM at &6C00-&6C0F,
  and a PRI interrupt ORs &80 into RAM at &6C0F; DmaActive() there reflects
  only DmaStart/DmaStop (CPCEC clears the bit at STOP). Caprice32 also
  reports the Plus CRTC as type 0 (CPCEC: 3, like real Plus machines).
- **Bare programs loaded by RUN" must end below &A67B** (AMSDOS HIMEM),
  although the bare map allows code up to &B7FF; plus_big_hi (library above
  &8000) is firmware-only for that reason. Cartridges have no such limit.

## 2026-10-04: Phase 7 stage gate, hands-on (user)

- Amstrad's Arnold 5 diagnostic cartridge, run by hand on Caprice32 (6128
  Plus) and CPCEC (-m3): DMA driven sound, sprites movement/palette, raster
  interrupt, split screen, soft scroll and the 4096-colour palette all
  behave correctly on both. (Caprice32's DMA support, unverified before, is
  fine.) Leaving a test: ESC, or reset the emulator (Caprice32 F5; CPCEC
  Ctrl+F5) to restart the cartridge at its menu.
- Differences, emulator-side only: CPCEC's 12-bit-to-RGB conversion is
  brighter (our Plus screen goldens are Caprice32's, so pixels differ in
  CPCEC by design) and its keyboard feels more responsive. CPCEC shows
  on-screen drive/tape indicators and an audio oscilloscope by default
  (Shift+F9 toggles; -O hides).
- Raster bars hands-on (user, Caprice32 and CPCEC side by side): each band
  changes colour part-way along its first line (the handler's fixed delay)
  and that switch point flickered by about two characters, at a different
  column in each emulator. Cause: the Z80 finishes its current instruction
  before taking the interrupt, and the test held its picture in `jr $`.
  A copy holding in HALT was stable on both. So: shot.bas's SHOT_HOLD loop
  now waits in HALT (plus_rasterbars golden updated, 224 pixels; stable over
  repeated runs), and cpcplus.bas documents it: for a steady split keep the
  main program in HALT while the lines go by (PAUSE/WaitVsync do).
- The sprites cartridge on CPCEC matched the golden except the title font:
  cartridge builds use -D CPC_OWNFONT (no firmware ROM font to copy), the
  golden comes from a disc boot with the ROM font. Expected.
- Split screen + fine scroll cartridge: identical on Caprice32 and CPCEC
  (split line, 5-pixel/3-line shift, extended left border). The three
  gate cartridges are the screen tests built as .cpr (bare, CPC_OWNFONT,
  SHOT_HOLD), so they are static by design; moving demos come in P5.
- **Stage gate passed:** Plus library tests green locally and in CI (both
  modes), Arnold cartridge fine on both emulators, our cartridges checked on
  CPCEC, cartridges up to 35 KB boot and copy correctly.

## Phase 7 P5: Plus demo and Starfall Plus stage 1 (2026-10-04)

- **Demo** (examples/plusdemo.bas, bare): 8 hardware sprites bouncing at
  x1/x2/x4, 12-bit colour cycling, 14 raster bars (steady: the main loop
  waits in WaitVsync), split screen (panel at &4000 over a landscape at
  &C000 scrolled pixel by pixel with SplitScreen + ScrollFine), a DMA tune
  (no CPU). Disc: `cpcrun.py examples/plusdemo.bas --model plus --bare`;
  cartridge: `sh examples/plusdemo/build.sh` -> build/plusdemo.cpr. 15.5 KB,
  must stay below &4000 (double buffering): ~0.8 KB left.
- **Library costs found by the demo:** SetPalette12 ~0.4 ms per colour,
  SpriteMove ~0.25 ms per call (one ENSURE + DI window + trampoline each),
  too slow for raster handlers and many sprites per frame; the demo writes
  the ASIC through the internal __PL_USER_IN/__PL_USER_OUT instead. To fix:
  cheap palette writes for handlers, a block SpriteMove, documented costs.
  Raster lines closer than a handler's run time misbehave (document).
- **Starfall Plus stage 1** (games/shooter/platform_plus.bas, -D PLUS,
  wrapping platform_cpc.bas; game.bas untouched): hardware sprites for the
  ship (slot 0), diver (1), bullets (2-3), bombs (4-6), explosions (7-10),
  formation still software; 12-bit pens and sprites; single-buffered with
  the songs linked in (no extra RAM needed, GX4000-safe). Register table
  written in one PlusPokeBlock (new library call) after the frame tick.
  Builds (build_plus.sh / make plus): build/starplus.dsk (`RUN"PLUS`,
  firmware; on a non-Plus it says so) and build/starplus.cpr (bare).
  19.5 KB (ends &4C73; fine beyond &4000 thanks to P3). 25.0 steps/s paced;
  unpaced 36.3 vs 36.7 for the plain 464 build: no CPU gain, the software
  formation dominates. Tests: games/shooter/tests/run.py --plus (disc +
  cartridge, logic 102 checks, plus_layer 47 checks, Plus goldens).
- **Stage 2 (multiplexed formation) not built:** Caprice32 draws all sprites
  once per frame from the final register values (asic_draw_sprites), so it
  cannot show raster multiplexing; CPCEC draws per scanline but its
  screenshots couldn't be automated. Design is ready (agent report): six
  slots re-positioned per row from three raster handlers, ~760 T-states of
  a ~1280 budget per handler.
