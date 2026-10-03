# Phase 6 design: bare-metal mode

Decisions (notes.md, 2026-10-03): **full API parity except disc**; chosen at
**compile time**; proven by **bare builds of Starfall CPC** (6128 and 464)
compared with the firmware builds; designed so a **no-firmware cartridge**
(Phase 7, GX4000) is mostly packaging. The 6128 bank helpers the plan lists
here already exist (cpcbuild banks library, Phase 5c).

## Why, given game mode

Game mode already removes most of the firmware's interrupt load (14.5 % →
3.3 %). Bare-metal mode adds:
- **memory:** about 8 KB, because the firmware's area at &A000-&BFFF is
  freed and the runtime's private block and stack move up under &C000;
- **speed:** our own text and graphics routines instead of the firmware's
  (PRINT, PLOT and DRAW are slow through the jumpblock);
- **independence:** no firmware at all, which a cartridge needs.

The cost is no disc after start (no AMSDOS). Data that must come from disc
is loaded first by a firmware-mode loader (as Starfall's loader already
does) before the bare program takes over.

## The switch

One compile option, `-D CPC_BAREMETAL` (or a backend option if the memory
map needs it — settled in B0), read by:
- **the runtime:** bare implementations behind the same entry points;
- **the backend:** a memory map with no firmware area.

Programs compile unchanged. Firmware-only features become compile errors in
bare mode: LOAD/SAVE, BankLoad, SoundQueue/firmware sound, direct firmware
calls through `.core.__FW_CALL`.

**Alternative kept on file:** a run-time switch. The program starts with the
firmware (so it can still load files), then calls `FirmwareOff()` to go bare.
That means linking both implementations and dispatching between them (bigger,
more complex), so it isn't built now. Revisit if user feedback prefers it.
Keep the bare runtime's entry points the same as the firmware ones, so this
stays possible later.

## Runtime in bare mode

- **Boot:** works whether or not the firmware ran first (disc, or a cold
  start from a cartridge). It:
  - sets DI, IM 1 and both ROMs off;
  - installs our own &0038 handler, with no chaining;
  - sets the mode, palette and CRTC directly;
  - copies the 8x8 font from the lower ROM when it's there (disc boot), or
    uses a bundled font (cartridge builds; our own MIT font);
  - initialises the private block.
- **Interrupt handler:** counts frames (VSYNC on PPI port B, plus the
  6-interrupt fallback, as in game mode) and calls the frame hook, so
  music and `Frames()` work. Bare mode behaves like permanent game mode;
  `GameMode()` becomes a no-op.
- **Text:**
  - PRINT, AT, TAB, INK, PAPER, CLS and scrolling in modes 0, 1 and 2,
    using our own glyph renderer and the existing pen map (colour.asm).
  - UDGs and `font.bas` index the glyph table directly (as zx48k's print.asm
    does), and SCREEN$ reads back against it.
  - Scrolling is a software scroll, or the CRTC start address with the
    library's offset handling (decided in B2).
- **Keyboard:** the matrix scan shared with the new held-key INKEY$ (Q15)
  and keys.bas (Q18). INPUT gets its own small line editor.
- **Sound:** BEEP on the AY directly (tone plus a duration in frames).
  Arkos music runs on the frame hook as now. Play works (it writes the AY
  itself).
- **Timing:** PAUSE from the frame counter.
- **Graphics (stage 2):** PLOT, DRAW, CIRCLE, POINT and OVER in the same
  coordinates as today (640x400 virtual, origin bottom-left, mode-dependent
  pixel size).
- **Memory map:** code from &0040; heap, private block and stack topped out
  just under &C000; screen at &C000 (&4000 back screen when double
  buffering).

## Steps and who does what

The main model designs, reviews every diff, re-runs every check and commits.
The boot and interrupt handler touch every bare program, so the main model
writes them.

| # | Work | Who |
|---|---|---|
| B0 | **Switch mechanism, bare memory map** (backend), **bare boot + interrupt handler + frame hook**, the compile errors for firmware-only features | **main model** |
| B1 | **Bare test harness:** printer echo by direct writes to the Centronics port, the END marker, `cpcrun.py --bare` / `run.py --bare` with skip markers for firmware-only tests, a **cold-start mode** in chipsrun (load the binary into fresh RAM, ROMs off, no firmware init, jump to the entry) to rehearse the cartridge case | sonnet |
| B2 | **Bare text:** glyph renderer, modes 0/1/2, AT/TAB/INK/PAPER/CLS/scroll, ROM-font copy or bundled font, UDGs, font.bas, SCREEN$ | sonnet |
| B3 | **Bare keyboard:** INKEY$ (held key), INPUT line editor, keys.bas on the shared scan | sonnet |
| B4 | **Bare sound and timing:** BEEP on the AY, PAUSE, Play, music on the frame hook, the GameMode no-op | sonnet |
| B5 | **Bare graphics (stage 2):** PLOT, DRAW, CIRCLE, POINT, OVER | sonnet |
| B6 | **Starfall bare builds** (6128, 464): loader loads the data, then the bare program runs; headroom and speed against the firmware builds; try fitting the full cpcbuild library in the 6128 build | sonnet |
| B7 | **Docs:** the zxbasic cpc page (bare mode), library.md, notes | haiku |

- **Order:**
  - B0, then B1.
  - B2, B3 and B4 in parallel (different runtime files).
  - Then B5, B6, B7.
- **Stage gate:** after B4, the whole conformance suite (bar the
  firmware-only tests) passes in bare mode on chips and Caprice32, 464 and
  6128, from both disc boot and cold start.

## Verification (main model)

- Conformance in firmware mode unchanged (no regressions), plus bare mode
  as above.
- Screen tests in bare mode (text screens must match the firmware ones
  pixel for pixel where the font is the same).
- zxbasic pytest; CI runs both modes.
- Starfall bare vs firmware: headroom below &4000 and steps/s.
- Play: the bare Starfall builds for the user.
