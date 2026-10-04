# Phase 7 design: CPC Plus / ASIC library

Decisions (user, 2026-10-04; notes.md):
- **Library home:** cpcbuild `lib/cpcplus/` (like `lib/cpcbuild` and
  `lib/music`; the plan's "stdlib" wording predates the Phase 5c move).
- **Raster interrupts: bare mode only.** Setting the ASIC's programmable
  raster interrupt (PRI) stops the CPC's normal six interrupts per frame
  (checked in Caprice32's crtc.cpp: the 52-line interrupt is suppressed while
  PRI is non-zero), and the firmware's keyboard scan, clock and sound queue
  run off those. Sprites, the 12-bit palette, scrolling and DMA sound work in
  both modes; `RasterIntAt` is a compile error in firmware mode. Faking the
  firmware's six ticks with extra raster lines is possible later.
- **Proof:** a Starfall Plus edition (hardware sprites, 12-bit palette) built
  as a `.cpr` cartridge (bare, no firmware: GX4000-style boot) and on disc for
  the 6128 Plus, plus a small Plus feature demo.
- **CI:** build Caprice32 headless at the pinned commit as a parallel job for
  the Plus tests (chips has no Plus).
- Emulators: Caprice32 (model 3 = 6128 Plus, `rom/system.cpr`, `.cpr` on the
  command line, `CAP32_SCRNSHOT`) for automated runs; CPCEC (`-m3`, `.cpr` on
  the command line) for manual cross-checks (plan, Phase 7).

## Facts to verify before relying on them

Each step's agent checks these against primary sources (cpcwiki ASIC pages,
Caprice32's asic.cpp/crtc.cpp, CPCEC's source) and records what it found in
its report:
- the 17-byte unlock sequence through the CRTC select port (&BCxx) and how to
  lock again;
- RMR2 (Gate Array, &7Fxx, value &B8 and friends): ASIC registers paged in at
  &4000-&7FFF, and the lower-ROM / cartridge-page selection;
- register map: sprite pixels &4000 (16 sprites x 256 bytes, low nibble per
  byte), sprite X/Y/magnification &6000+, palette &6400-&643F (pens 0-15,
  border, sprite colours 1-15) and its byte format, PRI &6800, SSSL/SSA split
  screen, SSCR soft scroll &6804, IVR, DMA channel registers &6C00+, DCSR
  &6C0F (and how interrupts are acknowledged in IM 1);
- the `.cpr` format (RIFF "AMS!", chunks "cb00".."cbNN" of up to 16 KB) and
  the cartridge boot state (page 0 at &0000, ASIC locked);
- what the Plus firmware (system cartridge) does to the palette: its periodic
  ink refresh writes Gate Array colours, which the ASIC turns into 12-bit
  values, so in firmware mode it may overwrite `SetPalette12` colours (as the
  firmware's ink tables did in Phase 5c).

## Constraints

- **The ASIC page covers &4000-&7FFF** while paged in: no library code,
  data or stack there during that time, and it collides with the 6128 back
  screen and the bank window. Paging routines must sit outside that range
  (or run from the private block) and restore the previous state.
- Both runtime modes (firmware and `-D CPC_BAREMETAL`) unless stated.
- Detection: `PlusAvailable()` must return 0 on a 464/664/6128 without
  side effects, so a program can choose at run time.
- Cartridge builds are bare builds plus a boot stub that copies the program
  from cartridge pages into RAM (the runtime keeps state in the program
  image), with `-D CPC_OWNFONT` (no firmware font in a cartridge-only
  machine).

## Steps and who does what

The main model (Opus) writes each spec, reviews every diff, reruns the checks,
commits and pushes. Agents never commit unless a step says so, never run git
stash/checkout/reset/clean, and keep temp files in their own scratch folder.

| Step | Work | Agent |
|---|---|---|
| P0 | This design, decisions, branch `phase-7` | main |
| P1 | **Plus harness.** `cpcrun.py --model plus` (Caprice32 model 3 with the system cartridge: through the F1/F2 menu, printer echo, END detection) and `.cpr` runs (cartridge replaces the system cartridge); `run.py` `REM MODELS: plus`; Plus screenshots via `CAP32_SCRNSHOT` with a determinism check, `tests/screens` support for Plus goldens; `tools/cpcec/` fetch + build script (pinned commit, no patch yet); a local, uncommitted fetch of Amstrad's Arnold diagnostic cartridge, run on Caprice32 and CPCEC with the results recorded; CI job building Caprice32 headless and running the Plus tests | sonnet |
| P2 | **ASIC core** (`lib/cpcplus/`): unlock/lock, page in/out, `PlusAvailable`, `SetPalette12` (pens, border), sprite palette, sprites (`SpriteSetImage` from packed 4-bit or 1-byte-per-pixel data, `SpriteMove`, `SpriteMag`, `SpriteHide`), the firmware palette interplay; conformance tests on the Plus (both modes) | sonnet |
| P3 | **Scroll, split, raster, DMA:** `ScrollSet` (SSCR), split screen (SSSL/SSA), `RasterIntAt` (bare only: a sorted table chained by the bare interrupt handler, which keeps the frame counter and frame hook working with PRI in use), DMA sound list helpers; tests | sonnet |
| P4 | **Tools:** `img2cpc.py --plus-sprite` (PNG to sprite data + 12-bit palette), `tools/mkcpr.py` (`.cpr` writer with the RAM-copy boot stub for bare builds), unit tests | sonnet (parallel with P1) |
| Gate | **Stage gate:** the Plus library passes its tests on Caprice32 (local and CI) in both modes, spot-checked in CPCEC; a `.cpr` hello-world boots. **Stop and report to the user** before P5 | main |
| P5 | **Proof:** Plus feature demo (`examples/`); Starfall Plus (hardware sprites, 12-bit palette) as `.cpr` and on disc for the 6128 Plus; tests and goldens | sonnet |
| P6 | **Docs:** `library.md` Plus section, README, notes; figures checked by main | haiku, checked by main |
