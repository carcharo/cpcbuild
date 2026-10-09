# Boriel BASIC → Amstrad CPC backend: handoff plan

Target repo: https://github.com/boriel-basic/zxbasic (v1.19.0 or later)

## Project vision

The ZX Spectrum Next has a productive high-level toolchain: Boriel BASIC
(compiler) + NextBuild (platform library: sprites, tiles, layers, music,
loader) + NextBuild Studio (VS Code fork with sprite/AYFX/block/map editors
and an image importer). The Amstrad CPC has nothing equivalent. It has
CPCtelera (excellent C/asm library and asset tools, no high-level language),
MPAGD (a fixed-genre game engine) and Locomotive BASIC (interpreted).

This project builds the CPC equivalent of that stack — working name
"CPCBuild" — in four legs, in this order:

1. **Compiler backend**: `--arch cpc` in Boriel (Phases 0–4a, 4b, 4d, 5a).
   The enabling step, not the product.
2. **Platform library**: `cpcbuild` — mode 0/1 sprites, tiles, maps,
   keyboard, AY effects, Arkos music — with a Boriel-style API (Phases 4c,
   5b). Prefer wrapping CPCtelera's LGPL asm routines over rewriting them.
3. **Demo game**: one small game built for Spectrum and CPC from a shared
   codebase with per-platform assets. The proof of the cross-platform story.
4. **Tooling**: CPC format support in the NextBuild Studio extensions (MIT,
   shipped as .vsix) — sprite viewer/importer with 27-colour quantisation,
   Arkos .aks playback, tile/map editing — rather than a new IDE.

Legs 3 and 4 are what attract users; legs 1 and 2 make them possible.

The upstream pitch for the Boriel PR: the Boriel dialect and ecosystem on a
second machine, and one game buildable for Spectrum and CPC. (ugBASIC already
targets the CPC as a multi-platform BASIC; this is a different proposition.)

## Repository layout

Two repos plus a locally built emulator, as siblings:

    ~/dev/
      cpcbuild/      # umbrella (this plan, project CLAUDE.md, lib/, tools/, demo/)
      zxbasic/       # fork of boriel-basic/zxbasic, branch cpc-arch — leg 1 only
      caprice32/     # built from source

- **zxbasic (fork)** holds only what a Boriel maintainer would merge:
  `src/arch/cpc/`, `src/lib/arch/cpc/{runtime,stdlib}/`, tests, a docs
  page, a minimal `tools/cpc/mkdsk.py` + run script (a DSK writer is a
  reasonable upstream contribution), and a short `CLAUDE.md` with the
  compiler rules only. Keep the diff reviewable.
- **cpcbuild (umbrella)** is the project's front door: this plan, the
  vision, README and screenshots, the `cpcbuild` platform library (outside
  the compiler, as NextBuild sits outside Boriel), asset converters,
  emulator scripts, the demo game, and later the Studio extension fork.
  Its `CLAUDE.md` names the sibling paths.
- **Branches:** one short-lived branch per phase (e.g. `pre-5a`, `phase-5a`)
  is merged into `main` at its milestone. zxbasic keeps its long-lived
  `cpc-arch` branch.
- Start Claude Code in the repo the phase touches: `zxbasic` for Phases 0
  to 4b and 4d; `cpcbuild` for -1 (emulator/tooling), 4c, 5b, 5c, 7, 8.
  Use `claude --add-dir ../zxbasic` when a session needs both trees.

## Goal (leg 1)

`zxbc --arch cpc prog.bas` produces a Z80 binary that runs on an Amstrad CPC
464/664/6128 via the firmware jumpblock, packaged as an AMSDOS `.bin` inside a
`.dsk`. The language stays Boriel BASIC (ZX dialect). Locomotive BASIC
compatibility is NOT a goal.

## Standing decisions (put these in CLAUDE.md)

- Firmware-first. All hardware access in v1 goes through the firmware
  jumpblock (&BB00–&BDxx). A bare-metal mode is a later phase.
- Default screen MODE 1 at boot. Default ORG &1000.
- Never modify `src/arch/zx48k/` or `src/lib/arch/zx48k/`. Copy files into
  the `cpc` tree and change the copies (same convention as the zx81sd port,
  PR #1090).
- Every hardware routine documents the firmware entry it calls and the
  registers it clobbers.
- Do not emulate the Spectrum attribute/colour-clash model. The Spectrum
  text layer (PRINT AT, INK, PAPER, UDGs) is preserved for compatibility;
  pixel graphics get a CPC-native library (see Phase 4c).
- Sound: pick one owner of the AY per program. Either the firmware sound
  manager (`SOUND_QUEUE`) for BEEP/simple effects, or direct AY access for
  the Play/music libraries. Never both at once.

## Reference: the zx81sd port (PR #1090, merged July 2026)

Worked example of adding an architecture. Copy its shape:

- `src/arch/<name>/` — backend package (`main.py`, `generic.py`, …)
- `src/lib/arch/<name>/runtime/` — sysvars, bootstrap, print, border,
  pause, vsync, charset, …
- `src/lib/arch/<name>/stdlib/` — BASIC-level libraries
- Sysvars relocated to a private RAM block instead of Spectrum ROM addresses
- Own PLOT/DRAW/BORDER/keyboard because no Spectrum ROM is mapped

Read the full diff before writing any code.

## CPC facts the port depends on

Memory map (firmware active):
- &0000–&003F: RST vectors (leave alone)
- &0040–&9FFF: free for program (use ORG &1000 by default; &0040 is possible)
- &A000–&B0FF: firmware variables (approx; do not touch)
- &B100–&BFFF: firmware jumpblock and workspace
- &C000–&FFFF: screen RAM (16 KB)

Screen modes: mode 0 = 160×200, 16 pens; mode 1 = 320×200, 4 pens;
mode 2 = 640×200, 2 pens. Palette: 27 hardware colours (4096 on Plus).
No attribute layer; every pixel has its own pen.

Screen byte layout: `addr = &C000 + (y & 7) * &800 + (y >> 3) * 80 + x_byte`.
Mode 0: 2 pixels/byte, interleaved bits. Mode 1: 4 pixels/byte, interleaved.
Mode 2: 8 pixels/byte, linear.

Interrupts: firmware runs IM1 at 300 Hz (6 per frame). `KL_NEW_FRAME_FLY`
(&BCD7) registers a 50 Hz callback. `MC_WAIT_FLYBACK` (&BD19) waits for vsync.

AY-3-8912: reached via the 8255 PPI, not a direct port. Data on port &F4xx
(PPI port A), register-select/write strobes on bits 6–7 of port C (&F6xx).
Register set is identical to the Spectrum 128K's AY.

Key firmware entries:
- Text: TXT_OUTPUT &BB5A, TXT_SET_CURSOR &BB75, TXT_SET_PEN &BB90,
  TXT_SET_PAPER &BB96, TXT_SET_MATRIX &BBA8, TXT_SET_M_TABLE &BBAB,
  TXT_CLEAR_WINDOW &BB6C
- Keyboard: KM_READ_CHAR &BB09, KM_WAIT_CHAR &BB06, KM_TEST_KEY &BB1E
- Screen: SCR_SET_MODE &BC0E, SCR_CLEAR &BC14, SCR_SET_INK &BC32,
  SCR_SET_BORDER &BC38
- Graphics: GRA_PLOT_ABSOLUTE &BBEA, GRA_LINE_ABSOLUTE &BBF6,
  GRA_MOVE_ABSOLUTE &BBC0, GRA_SET_PEN &BBDE
- Sound: SOUND_QUEUE &BCAA, SOUND_CHECK &BCAD, SOUND_RESET &BCA7
- Machine: MC_WAIT_FLYBACK &BD19, KL_NEW_FRAME_FLY &BCD7

Verify all addresses against cpcwiki.eu before use.

---

## Phase -1 — Environment setup (macOS)

Prerequisites the user does by hand (interactive / admin password):
- Xcode Command Line Tools (`xcode-select --install`) and Homebrew
- Claude Code installed and signed in
- Retro Virtual Machine 2.0 downloaded from retrovirtualmachine.org and
  placed in /Applications (manual DMG; not in Homebrew)

Claude Code does the rest (session started in `cpcbuild`, with
`--add-dir ../zxbasic`):
- `poetry install` and `poetry run pytest -x -q` to confirm the suite is
  green before any changes.
- `brew install sdl2 libpng freetype` (check Caprice32's README for the
  current dependency list), then clone github.com/ColinPitrat/caprice32
  into a sibling directory and build with `make APP_PATH="$PWD"`. The CPC
  ROMs ship in the repo. Verify it boots to the BASIC prompt.
- Install iDSK (`brew install idsk` if a formula exists, else build from
  source) OR write `tools/cpc/mkdsk.py` (AMSDOS header + DSK writer in
  pure Python — preferred, no external dependency, and reusable in CI).
- Add `tools/cpc/run.sh` / a `make run` target: `zxbc --arch cpc` →
  `.bin` → `.dsk` → `cap32 out.dsk -a 'run"prog'`. Note `cap32` opens a
  window; the user reports what they see until the Phase 5a harness exists.
- Record all versions and paths in docs/cpc-port-notes.md.

## Phase 0 — Recon (read only, no code)

1. Clone the repo; read PR #1090 in full.
2. Find how an arch is registered: `arch.set_target_arch`,
   `OPTIONS.architecture`, the valid-arch list in `zxbc`, and any per-arch
   test directories.
3. Inventory `src/lib/arch/zx48k/runtime/` and classify every file:
   - **Pure Z80** (arithmetic, strings, heap, arrays, DATA/READ): keep verbatim
   - **Sysvar/ROM-dependent** (error handling at 23610, CHECK_BREAK, any
     `rst` or `call` into ROM, especially float/calculator routines): rewrite
   - **Spectrum hardware** (print, attributes, PLOT/DRAW, BEEP, BORDER,
     INKEY, UDG/CHARS handling): rewrite
4. Confirm specifically whether float arithmetic depends on the Spectrum ROM
   calculator and what zx81sd did about it.
5. Find the AY register-write primitive in the 1.19.0 Play library (grep for
   `FFFD`, `BFFD`, `out (c)`).
6. Write the classification and findings to `docs/cpc-port-notes.md`.

## Phase 1 — Scaffold

- Create `src/arch/cpc/` by copying the zx48k package.
- Create `src/lib/arch/cpc/{runtime,stdlib}/`.
- Register `cpc` as a valid architecture; default ORG &1000.
- Milestone: an empty program compiles with `--arch cpc` to a flat binary,
  with every hardware routine stubbed.

## Phase 2 — Minimal runtime

- `sysvars.asm`: relocate all Spectrum sysvar addresses into a private RAM
  block (ERR_NR, FLAGS, UDG, CHARS, etc.).
- `bootstrap.asm`: save SP/IX/IY, `ei`, return cleanly to BASIC on END.
- `print.asm`: character out via TXT_OUTPUT; PRINT AT via TXT_SET_CURSOR;
  CLS via SCR_CLEAR. Map Boriel's embedded INK/PAPER/AT control codes to
  the firmware equivalents.
- Packaging: a Python tool (or `zxbc` output option) that prepends the
  128-byte AMSDOS header and writes a `.dsk` (implement the DSK format
  directly or shell out to `iDSK`). Optional `.cdt` via 2cdt.
- Milestone: `PRINT "Hello CPC"` runs in an emulator.

## Phase 3 — Core language conformance

- Compile the existing functional-test `.bas` programs for `cpc`; run them;
  fix ints, strings, arrays, floats, heap, DATA/READ.
- If floats use the ZX ROM calculator, lift a self-contained FP library or
  reuse the zx81sd solution.
- CHECK_BREAK: poll ESC via KM_TEST_KEY, or make BREAK a no-op under a flag.

## Phase 4a — Text, input, basic graphics

- INKEY$ → KM_READ_CHAR; INPUT built on it.
- PLOT/DRAW/CIRCLE → GRA_PLOT_ABSOLUTE / GRA_LINE_ABSOLUTE. Document the
  coordinate differences (CPC 0–639 × 0–399 virtual, origin bottom-left,
  mode-dependent pixel size).
- INK/PAPER → TXT_SET_PEN / TXT_SET_PAPER; BORDER → SCR_SET_BORDER;
  PAUSE → MC_WAIT_FLYBACK loop; BEEP → SOUND_QUEUE approximation.
- `cpc.bas` stdlib: `Mode n`, `SetInk pen, colour`, `SetBorder c`,
  `WaitVsync`.

## Phase 4b — UDGs and custom fonts

- Allocate a 21×8-byte table in the sysvar block for CHR$ 144–164; point the
  UDG sysvar at it.
- At bootstrap call TXT_SET_M_TABLE with that table as the user matrix
  table starting at code 144. `POKE USR "a"+n` then writes straight into
  the live glyph table and `PRINT CHR$ 144` works via TXT_OUTPUT.
- Glyph format is 8×8 1bpp in every mode, identical to the Spectrum, so UDG
  data ports byte-for-byte.
- Decide: also cover 128–143 so Spectrum block graphics render (CPC's own
  128+ glyphs differ), and whether CHARS/custom fonts map to a full
  224-entry table from code 32 (same mechanism, bigger table).

## Phase 4c — Graphics model and the `cpcbuild` library (leg 2)

- Rule: no attribute emulation. Text layer via firmware; pixel graphics
  CPC-native.
- `cpcbuild` library (firmware-free, direct VRAM): screen address calc,
  mode 0 and mode 1 sprite blit (plain and masked), tile put, tilemap draw,
  rectangle fill, keyboard scan, double buffering. API shaped after
  NextBuild's so Spectrum Next users find it familiar.
- **Asm layer decision**: CPCtelera (github.com/lronaldo/cpctelera,
  `development` branch) is LGPL v3. Its `cpct_drawSprite*`,
  `cpct_drawTileAligned*`, `cpct_scanKeyboard*`, `cpct_setVideoMode`,
  `cpct_setPalette` routines are the fastest known implementations. Prefer
  extracting these into `src/lib/arch/cpc/stdlib/cpctelera/` with
  attribution and licence file, exposing them via Boriel `asm` blocks,
  over rewriting. Check the SDCC calling convention on each routine and
  write a small register-shim per function. Note in docs/cpc-port-notes.md
  which routines were taken and their upstream revision.
- Asset pipeline: reuse CPCtelera's `cpct_img2tileset` / img2cpc and
  `tmx2data` where the formats fit; add a thin converter that also emits
  1bpp + attribute data for the Spectrum from the same source PNG. Shared
  game logic, per-platform assets selected with `#ifdef` on the arch
  macro.
- Palette helper: `SetPalette DATA-list` mapping pens to hardware colours.

## Phase 4d — AY primitive

- Factor the Play library's AY write into one arch-specific
  `AY_WRITE(reg, value)` routine. Spectrum: `out` to &FFFD/&BFFD.
  CPC: PPI sequence (select register via port C bits, write data via port A,
  return port C to inactive).
- Play library then builds on both targets unchanged.
- Document the firmware conflict: any program using Play/music must not call
  SOUND_QUEUE, and should call SOUND_RESET once at start.

## Phase 5a — Tests, docs, upstream

- Expected-asm snapshot tests under the arch-specific test directory,
  mirroring zx48k/zx81sd; CI job for `--arch cpc`.
- Development is on macOS. Day-to-day build/run loop: Caprice32
  (github.com/ColinPitrat/caprice32, build from source with
  `make APP_PATH="$PWD"`; open source C++/SDL, debugger, memory editor,
  `-a` autocmd for `cap32 prog.dsk -a 'run"prog'`). Add a `make run`
  target that compiles, wraps the .dsk and launches it. Plus support
  improved by commits 082eb57 (2026-07-17, raster interrupt) and 20a2604
  (2026-09-04, interrupt fixes); used for Phase 7.
- Automated reference: a headless harness on floooh's `chips` CPC core
  (`systems/cpc.h`, header-only C, zlib/libpng licence): boot, load
  AMSDOS `.bin`, run N frames, assert framebuffer/RAM. Lives in
  `cpcbuild/tools/chipsrun/` and is the CI runner. Models CPC 464 and
  6128 (no 664, no Plus); its Z80 is cycle-stepped and passes ZEXALL,
  with all chips ticked together.
- Optional manual spot-check: Retro Virtual Machine 2.0 (reference-grade
  emulation, used at Plus milestones, Phase 7, or when emulators disagree).
- Upstream: the PR is deferred (fork-only, see decision above).
- Docs page.

## Phase 5b — Music player wrapper

- `music.bas` stdlib wrapping an Arkos Tracker 2 player (AKG or AKY),
  pulled in via `#include` of asm: `MusicInit addr`, `MusicFrame`,
  `MusicStop`, optional `SfxPlay`.
- Arkos exports the same player for Spectrum and CPC with only the register
  write routine differing, so one tracker file serves both ports.
- `MusicFrame` is called once per frame after `WaitVsync`, or hooked to the
  firmware 50 Hz frame-flyback event via KL_NEW_FRAME_FLY.

## Phase 5c — Demo game (leg 3)

- One small game (single-screen platformer or shooter), one `.bas` codebase,
  built for `--arch zx48k` and `--arch cpc` with per-platform asset
  directories. Mode 0, 16 colours on the CPC; attribute-aware assets on
  the Spectrum. Arkos tune played on both.
- Lives in a separate repo (not the compiler fork). This is the README
  screenshot and the thing to post on the forums.

## Phase 6 — Bare-metal mode

- Optional build flag: no firmware. Own interrupt handler, own print/plot
  routines (UDG table indexed directly as zx48k/print.asm does), keyboard
  via direct PPI scan. Frees &A000–&BFFF and removes the 300 Hz overhead.
- 128K bank switching helpers for the 6128.

## Phase 7 — CPC Plus / ASIC library

Keep this a stdlib on the same `cpc` arch (the way Next extras sit alongside
the base Spectrum runtime), not a separate architecture. Base machine,
firmware and video are identical; the ASIC is opt-in.

The Plus is the closest CPC analogue to the NextBuild model: hardware
sprites, wide palette, hardware scroll and raster interrupts map onto the
same concepts as Next sprites and Layer 2, so the `cpcplus` API can borrow
NextBuild's shape almost directly.

ASIC facts:
- Unlock: 17-byte sequence written through the CRTC register-select port.
- ASIC I/O page mapped into &4000–&7FFF via Gate Array RMR2.
- 16 hardware sprites, 16×16, one byte per pixel, 15 colours + transparent,
  1×/2×/4× magnification per axis. Pixel data at &4000+ (256 bytes each);
  position/magnification registers at &6000+; sprite palette at &6422+
  (12-bit).
- 32 extra 12-bit palette entries at &6400+.
- Pixel-level hardware scroll (SSCR), programmable raster interrupt (PRI),
  three DMA sound lists driving the AY without CPU time.

`cpcplus.bas` stdlib:
- `PlusUnlock`, `PlusPageIn`, `PlusPageOut`
- `SpriteSetImage n, addr`, `SpriteMove n, x, y, magx, magy`, `SpriteHide n`
- `SpritePalette DATA-list`, `SetPalette12 pen, rgb`
- `ScrollSet dx, dy`, `RasterIntAt line, handler`
- Optional DMA sound list helpers

Tooling: PNG → one-byte-per-pixel sprite blob converter; `.cpr` cartridge
writer for the Plus range (a `.dsk` still works on the 6128+).

Acceptance check: the Arnold system test cartridge, run in Caprice32 and
CPCEC. (Here "Arnold" is Amstrad's codename for the Plus range: the
cartridge is Amstrad's own diagnostic, unrelated to the Arnold emulator.)
In Caprice32 its raster interrupt test passes since commit 082eb57 (fixes
in 20a2604); DMA interrupt vectors are implemented but not yet verified.

Plus emulators (decided 2026-10-03): Caprice32 (day-to-day, automated)
and **CPCEC** as the second Plus emulator to test against (chips has no
Plus). CPCEC (César Nicolás-González, GPLv3, mirror github.com/cpcitor/
cpcec): ASIC support since 2020 with continued fixes, tested by its
author with PLUSTEST and the Arnold 5 diagnostic ROM; `-m3` Plus/GX4000,
a `.cpr` on the command line boots directly (a real no-firmware cartridge
boot); debugger, unthrottled mode (`-R`), printer to file. Builds on macOS
from one file: `cc -DSDL2 -O2 -xc cpcec.c -I/opt/homebrew/include
$(sdl2-config --libs)`. Start with manual checks (ASIC library, Plus
demos, our `.cpr` builds); if worth automating, keep a small patch in
cpcbuild (`tools/cpcec/`: fetch script pinned to a commit + patch, like
chipsrun) adding a printer file option, exit on reset and no window, so
`run.py --emu cpcec` works. Not chosen: WinAPE (Windows only), the
Arnold emulator (rofl0r/arnold: an old Linux port on SDL 1.2/GTK 2,
fewer features than its Windows version, no automation).

## Phase 8 — Tooling: CPC support in NextBuild Studio extensions (leg 4)

NextBuild Studio (github.com/em00k/NextBuildStudio) is a VS Code fork; its
viewers, editors and importer are MIT-licensed VS Code extensions shipped
as `.vsix`. Extend rather than replace:

- Sprite viewer/editor: add CPC mode 0 (2 px/byte interleaved) and mode 1
  (4 px/byte) formats alongside the Next 4-bit/8-bit formats.
- Image importer: add a 27-colour CPC hardware palette target with
  quantisation, and 12-bit palette for Plus; export to `cpcbuild` blobs.
- Palette viewer: CPC hardware colour numbers and Plus 12-bit RGB.
- Tile/block/map editors: reuse the existing block/map model with CPC tile
  formats.
- Music: Arkos Tracker 2 `.aks` playback (external player path setting,
  like the existing playpt3 integration) and AYFX support unchanged.
- File icons and templates for `.dsk`, `.cdt`, `.cpr` and CPC projects.
- Build/run action buttons: `zxbc --arch cpc` + dsk packaging + emulator
  launch.

Design reference: vscode-kcide (github.com/floooh/vscode-kcide, MIT) is
chips compiled to WASM running in a VS Code tab with a chip-level debugger
(cycle stepping, memory/IO/interrupt breakpoints); it supports CPC6128 and
builds only from its own assembler. Offers a model for tighter VS Code
integration than the NextBuild Studio approach.

Contact em00k once the Phase 5c demo exists: the README asks for contributors and a shared
Next/CPC codebase for the extensions benefits both platforms.

**Research task R8 (before Phase 8 starts; after Phase 7, when CPCEC is
known from the Plus work). Owner: main model, with a sonnet agent for the
build spike.** Can CPCEC be the in-VS Code emulator?
- Technical: compile CPCEC to WASM (Emscripten has an SDL2 port; or replace
  its SDL2 front end with a small host interface: frame buffer, audio
  buffer, key events) and run it in a VS Code webview; frame rate, audio,
  how much of cpcec-ox.h (the SDL2 layer) needs changing; debugger hooks.
  Compare with vscode-kcide (chips in WASM, MIT, but no Plus).
- Licence (GPLv3): what shipping a GPLv3 WASM module inside a `.vsix`
  means for the extension. Questions: is a separate WASM module that the
  extension talks to by messages "aggregation" (extension keeps its MIT
  licence) or one combined work (whole extension GPLv3)? Source-offer
  duties for the WASM binary; compatibility with NextBuild Studio's MIT
  extensions and em00k's wishes; whether to ask César Nicolás-González
  (CPCEC's author) about the use or a licence exception. Outcome: a short
  recommendation (CPCEC WASM, chips WASM with Plus left to an external
  emulator, or launching the desktop emulator) for the user to decide.

  **R8 outcome (2026-10-09):** CPCEC builds to WASM unchanged (SDL2 port +
  ASYNCIFY, tools/cpcec/wasm/build.sh) and runs at full speed in a browser
  tab. User's decision: the emulator is its own GPLv3 extension; the MIT
  extensions drive it through VS Code commands/messages. Details in
  docs/notes.md.

**After Phase 8: platformer tutorial (user idea, 2026-10-04).** Build the
platformer (the deferred Phase 5c extra) and turn it into a step-by-step
tutorial that teaches the toolchain by following it: project setup in the
Phase 8 tools, sprites and tiles through the editors/importer, cpcbuild
calls, music, building for CPC and Spectrum. Revisit once Phase 8 is done,
so the tutorial shows the finished tools.

Library additions for the platformer (Plus hardware sprites, user ideas
2026-10-04), in `lib/cpcplus`:
- **Sprite manager:** allocate/free the 16 slots as objects enter and leave
  (level scrolling, screen changes), with an image cache so an image already
  in a slot isn't uploaded again (an upload is ~1.4 ms per sprite); spread
  uploads over frames while scrolling; optional multiplexing helpers (re-use
  slots further down the screen from raster interrupts, bare mode).
- **Palette cycling:** rotate a range of sprite colours (entries 17-31) or
  screen pens each frame (a few palette writes, ~0.1 ms each) for cheap
  animation (flames, flashing, water, conveyor belts); the sprite palette is
  shared by all 16 sprites, so reserve the cycled indices; per-band cycles
  via raster interrupts in bare mode.

---

## Open questions to resolve during Phase 0

1. Does Boriel's float runtime need the Spectrum ROM? What did zx81sd do?
2. What is the arch preprocessor macro name for `#ifdef` (check zxnext)?
3. Which emulator can run headless for CI?
4. Does the Play library assume 128K Spectrum port addresses in more than
   one place?
5. Which CPCtelera routines are self-contained enough to lift (no SDCC
   runtime dependencies), and what calling convention do they use?
6. (Deferred until Phase 5c has a demo to show) Is em00k open to CPC
   formats in the NextBuild Studio extensions?
