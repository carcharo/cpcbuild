# Phase 5c design: one game, four builds

Decisions (notes.md, 2026-10-03): a **single-screen shooter** first (a
platformer later, as an extra, once the wrinkles are out); builds for
**Spectrum 128K and 48K** and **CPC 6128 and 464**; the game lives in
**`cpcbuild/games/`** for now (its own repo later); the cpcbuild graphics
library **moves out of the zxbasic fork into `cpcbuild/lib`** as the first
step, with the zxbasic cpc page restructured to be about the compiler only.
All CPC builds start at **&0040** (4 KB more).

## The four builds

| Build | Screen | Music | Memory |
|---|---|---|---|
| CPC 6128 | mode 0, double-buffered (&4000 back screen) | Arkos, frame hook, game mode | code &0040-&3FFF; music and level data in the extra 64 KB, paged into &4000-&7FFF with interrupts off |
| CPC 464 | mode 0, single-buffered (sprites erased and redrawn in flyback order) | Arkos, frame hook, game mode | code and data &0040-&9DFF (no back screen) |
| Spectrum 128K | double-buffered on the shadow screen (bank 7) | Arkos (Spectrum AKG player, same tune exported for the 1.77 MHz AY), IM2 frame hook | banks for data |
| Spectrum 48K | single-buffered | silent (or beeper effects) | 48K |

One source: shared game logic with no `#ifdef`, plus a thin portable layer
(`game_gfx.bas`, `game_snd.bas`, `game_input.bas`) with one
implementation per platform. On the CPC it uses cpcbuild (sprites, tiles,
keys, palette, music); on the Spectrum, Boriel's zx48k libraries (MIT:
`cb/maskedsprites.bas` with background save/restore and shadow-screen
switching, `puttile.bas`, `IM2.bas`, a keyboard reader). Builds are chosen
with `--arch` and `-D` switches (`CPC464`, `CPC6128`, `ZX48`, `ZX128`).
One CPC disk carries both CPC builds and a tiny loader that checks the
model and runs the right one.

Assets come from the same sources: pixel art drawn by a script into PNGs,
then `img2cpc.py` (CPC mode 0, plus `--spectrum` for bitmap and attributes);
the tune and effects generated as .vt2 and exported per platform with
`aks2bas.py` (PSG clock per target).

## Steps and who does what

The main model writes the specs, reviews every diff, makes the design
calls (the game rules and the portable layer's API), re-runs every check,
and commits. Execution goes to lower-tier agents.

| # | Work | Who |
|---|---|---|
| D0 | **Library move:** zxbasic `stdlib/cpcbuild*` and `runtime/cpcbuild/` go to `cpcbuild/lib/cpcbuild/`, keeping `#include <cpcbuild.bas>` working via `-I lib`. Check that `#require` resolves there. The library's sysvars and the generic reserved-range hook stay in the fork. Fork tests that covered the library (cb_* snapshots, the phase-4c corpus entry) move to cpcbuild or are rewritten. Then restructure the zxbasic `amstrad_cpc.md` (compiler differences only; one closing section on cpcbuild as the example project) and repoint library.md. | sonnet (docs part: haiku); main reviews |
| D1 | **ORG &0040:** tools take the program's origin (cpcrun, AMSDOS header, mkdsk, run.sh, Makefile). Prove RUN" loads at &0040 on 464/664/6128, that &0030-&003F (FP restart, our vector, the firmware's &003B) stay intact, and that the suite passes built at &0040. The compiler default stays &1000 (question 14) unless the user decides otherwise. | sonnet |
| D2 | **chipsrun Spectrum mode:** zx.h 48K/128K, quickload of zxbc's `.z80`. Test output through the ZX printer port (&FB) or a marker port, with the same PASS/FAIL/DONE and END conventions; typed keys; screenshots. A runner flag for `--arch zx48k` builds. | sonnet |
| D3 | **Spectrum music:** tools/arkos converts the AKG player for the Spectrum (byte-identical check); a zx48k `music.bas` with the same API, driven by an IM2 frame hook (IY and the ROM's needs respected); `aks2bas.py` exports with the Spectrum PSG clock; tests on chips 128K. | sonnet |
| D4 | **6128 banking library** (`lib/cpcbuild/banks.bas`): select RAM configurations &C4-&C7 (with the firmware's view kept right), copy data in and out, and let the music hook page the song's bank in and out around each tick. Tests on the 6128 (chips and Caprice32). | sonnet; main reviews the interrupt and paging parts |
| D5 | **The shooter:** the portable layer (CPC and Spectrum implementations), the game logic, generated assets and music, the four builds, and the CPC loader disk. | main writes the game spec; sonnet ×2 (CPC side, Spectrum side) |
| D6 | **Tests and CI:** all four builds in CI; golden screenshots (title, a fixed gameplay frame via `-D SHOT`) per build on chips; game-layer conformance tests on all four; per-build speed benchmarks. | sonnet |
| D7 | **Docs:** README game section, library.md (banks, ORG), notes; a play and listen session for the user. | haiku |

Order:
- D0 first: it moves the library everything else uses. D2 (new Spectrum
  runner code) and D3 (tools/arkos, lib/music) can run alongside it, since
  they touch other files.
- D1 after D0, because both edit `cpcrun.py`. D4 after D1.
- D5 when D2-D4 are in (the portable layer can start earlier). D6 with
  D5, D7 last.

Later extra: the single-screen platformer on the same layer (tile-map level,
collision), once the shooter has ironed out the cross-platform wrinkles.

## Verification (main model)

- Conformance on Caprice32 (464, 664, 6128) and chips (CPC 464/6128, ZX
  48K/128K); screen tests; zxbasic pytest; CI green on `phase-5c`.
- Each build's update rate in normal and game mode (CPC), on 48K and 128K.
- Play and listen: each build in its emulator window, for the user.
