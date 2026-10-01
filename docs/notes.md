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

## Questions for when you're back (raised up to Phase 4a)

Decisions the next phases need, most urgent first. Detail is in
cpc-port-notes.md.

1. ~~END and a program's output.~~ Answered 2026-10-01: END waits for a key.
2. **Interrupts, stage 2 (§6.1).** Today interrupts only run inside firmware
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
8. **UDGs and the character set (Phase 4b).** Cover 128-143 so Spectrum
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
16. **SCREEN$.** The firmware can read a character back from the screen
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

## Recommendations in use (see cpc-port-notes.md §5–§6)

- Registers (§6.1), recommended: a firmware gate that restores BC' from a
  shadow on every call; interrupts only inside firmware calls in Phase 2–3,
  then an own IM1 front-end at &0038 before music (Phase 4d/5b).
- Memory map (§6.2), recommended: ORG &1000; fixed heap top-aligned under a
  1 KB private block at &9E00; 1 KB stack with SP = &A600; &A67B is the top.
- FP calculator on RST 6 (&0030) with `rst 30h` copies of 25 files (Q1).
