# Starfall

A single-screen shooter (Phase 5c demo) in one Boriel BASIC codebase for four platforms: Amstrad CPC 6128 and 464, ZX Spectrum 128K and 48K. The game is deliberately simple to showcase the cross-platform build machinery and per-platform asset pipelines.

## How to play

| Input | Action |
|-------|--------|
| **O** or **←** | Ship left |
| **P** or **→** | Ship right |
| **Space** or **↓** | Fire (up to 2 bullets on screen) |
| **Any key** | Start game, dismiss prompts |
| **Joystick** | CPC joystick 0 or Spectrum Kempston; fire is button 1 |

**Goal:** Shoot the enemy formation before it reaches you. Points: 10 / 20 / 30 per row (bottom to top), 50 for a diving enemy. Three lives to start.

**Music:** Title tune and quieter in-game loop (music builds only).

**Sound effects:** Shoot, enemy explodes, player hit, wave cleared.

See [DESIGN.md](DESIGN.md) for the full rules, coordinate system, asset pipeline and test suite.

## The four builds

| Platform | Build | Command | Output | Music | Double-buffered | Starts at |
|----------|-------|---------|--------|-------|-----------------|-----------|
| **CPC 6128** | 6128 (`-D CPC6128`) | `build_cpc.sh` | `starfall.bin` + `starfall.dat` on `starfall.dsk` | Yes, in extra bank 0 | Yes | &0040 |
| **CPC 464** | 464 (`-D CPC464`) | `build_cpc.sh` | `starfa64.bin` on the same disc | Yes, in main RAM | No | &0040 |
| **CPC 6128 bare** | 6128 + `-D CPC_BAREMETAL` | `build_cpc.sh` | `starbare.bin` (+ `starfall.dat`) on the same disc | Yes, in extra bank 0 (put there by the loader) | Yes | &0040 |
| **CPC 464 bare** | 464 + `-D CPC_BAREMETAL` | `build_cpc.sh` | `starba64.bin` on the same disc | Yes, in main RAM | No | &0040 |
| **Spectrum 128K** | 128 (`-D ZX128`) | `build_zx.sh 128` | `starfall128.tap` | Yes (IM2 hook) | Yes (bank 7) | &7C00 |
| **Spectrum 48K** | 48 (`-D ZX48`) | `build_zx.sh 48` | `starfall48.tap` | No music; short beeper effects | No | &8000 |

**Disc loader:** One AMSDOS disc (build/starfall.dsk) with all four CPC builds and two loaders, one source (`loader.asm`):

- `RUN"DISC` (DISC.BIN) detects the 6128's extra RAM and starts the firmware build, `STARFALL.BIN` (6128) or `STARFA64.BIN` (464).
- `RUN"BARE` (BARE.BIN, `loader_bare.asm`) starts the bare-metal build: no firmware, the program's own boot, interrupt handler and text code. A bare program cannot read the disc, so on a 6128 this loader first loads `STARFALL.DAT` (the songs) and copies it into extra RAM bank 0 itself; then it loads `STARBARE.BIN` (6128) or `STARBA64.BIN` (464) and jumps to it. The game checks the songs' signature in the bank and plays silent if they are not there (for example started without the loader). The bare builds look and play like the firmware ones (same screenshots, same speed).

Bare and firmware builds are both on the one disc because they cost nothing to carry; `RUN"DISC` is the default.

The loaders run at &9E00 with their 2 KB AMSDOS buffer at &9600, above everything a game build loads (the 6128 builds reach &83CA); `RUN"BARE` stages the songs at &8000 before the game is loaded over them. Details in the `loader.asm` header.

## Starfall Plus (CPC Plus / GX4000)

The same game with the Plus's hardware: the ship, the diver, the bullets, the bombs and the explosions are ASIC hardware sprites (see `platform_plus.bas`), and the playfield and sprites use 12-bit colours. In the disc build the formation is still drawn in software; in the cartridge (`-D PLUS_MUX`) it is too hardware: six sprites, re-positioned and recoloured for each of the three rows by raster interrupts (`platform_plus_mux.inc`), one shared alien shape per frame, a row colour each. Where the multiplexing cannot show a frame (a row of more than 6, rows closer than 12 lines, a sprite out of the ASIC's range, more than 24 formation sprites in a frame) the layer draws that frame's formation in software. Build with `sh build_plus.sh` (or `make plus`):

- `build/starplus.cpr`: a cartridge (bare metal, `-D PLUS -D CPC_BAREMETAL -D CPC_OWNFONT -D PLUS_MUX`, `tools/mkcpr.py`). The music is linked into the program, so no disc or extra RAM is needed (it runs on a GX4000).
- `build/starplus.dsk`: `RUN"PLUS` for a 6128 Plus (firmware mode). `RUN"DISC` is unchanged. On a non-Plus the game says it needs a Plus and to use `RUN"DISC`.

Speed: 25.0 steps/s (500 frames for 250 steps) on both; unpaced the disc build does 36.7 steps/s (the software formation dominates), the cartridge 50 steps/s. `make test-plus` runs the Plus tests (Caprice32); `make test-cpcec` runs the cartridge's on CPCEC, which draws the sprites per scan line and so shows the multiplexed formation (Caprice32 draws every sprite once a frame): `tests/plus_mux.bas` and goldens in `tests/golden/cpcec-plus/`.

## Build and run

### CPC (Caprice32 or real hardware)

```bash
cd games/shooter
bash build_cpc.sh        # generates build/starfall.dsk
cd ../..
make run PROG=games/shooter/build/starfall.dsk
```

Or run the disc in Caprice32 or a real CPC: load build/starfall.dsk, then `RUN"DISC` (firmware builds) or `RUN"BARE` (bare-metal builds).

### Spectrum (FUSE or real hardware)

```bash
cd games/shooter
bash build_zx.sh all     # generates build/starfall48.tap and build/starfall128.tap
```

Load either .tap file with `LOAD ""` in a Spectrum emulator (FUSE, Spectaculator, etc.) or on real hardware. The BASIC loader auto-runs the code.

### Headless tests and screenshots (on chips and Spectrum emulators)

```bash
make test-games          # Starfall logic and screenshot goldens (all four builds)
make test-zx             # Spectrum builds only
```

## Performance

Every build runs the game logic at 25 Hz: one step every two frames. BENCH
(250 steps of attract mode) gives:

| Build | Sound | Steps/s |
|---|---|---|
| CPC 6128 | music + effects, game mode | 25.0 |
| CPC 464 | music + effects, game mode | 25.0 (about 30 % spare when unpaced) |
| Spectrum 128K | music + effects | 24.2 |
| Spectrum 48K | beeper effects | 25.0 |

**Game mode:** both CPC builds switch it on while playing, which hands back the
firmware's interrupt load (about 11 % of the CPU). Without it the 6128 drops a
little (24.2-24.9), because a step that overruns waits for the next flyback.

**Spectrum 128K:** most steps fit the two-frame budget, but about 20 of 250
(formation moves and similar peaks) take a third frame; the Arkos player costs
about 0.2 frame per step. Options to reach 25: a cheaper player, or trimming the
peak steps.

**Spectrum 48K beeper effects:** shoot (~3 ms), enemy explodes (~2.5 ms), player
hit (~23 ms, during the hit pause), wave cleared (~75 ms arpeggio, between
waves); at most one effect per step, interrupts off while it plays.

## Known limits

- **Spectrum 128K at 24.2 steps/s:** most steps fit the two-frame budget, but about 20 of 250 (formation moves and similar peaks) take a third frame; the Arkos player costs about 0.2 frame per step. Options: a cheaper player, or trimming the peak steps.
- **Memory:** with double buffering the 6128 builds' code must end below &4000 (the back screen): the firmware build ends 1,104 bytes below it, the bare build 639. Their graphics (1 KB) are placed from &8000 with `#pragma hidata`, which leaves the file padded with zeros over &4000-&7FFF (33.7 KB; a little longer to load from a real disc). The extra RAM bank holds the music.
- **Sprites:** both platforms draw through the libraries: CPC `cpcbuild/spritelist.bas` (sprites on the plain black playfield, erased by clearing their box), `text.bas` and `tiles.bas`; Spectrum `zxbuild/sprites.bas`. Each layer keeps a little assembly for the per-sprite call and, on the CPC, the HUD and stars, where BASIC measured too slow (see the layer headers).

## Tests

- **102 logic checks:** collision, scoring, formation steps, wave speed-up, lives and game over, on all four builds, and on the CPC bare builds (also cold-started with no firmware).
- **Screenshot goldens:** CPC 6128 and 464: title and a gameplay frame each (the bare builds, warm and cold, are compared with the same goldens); Spectrum 48K and 128K: title, an attract-mode gameplay frame and a started game each, plus the layer test scene.
- **Disc test:** `make disc` (tests/disc.py) runs RUN"DISC and RUN"BARE on Caprice32, 6128 and 464, and checks each picks the right build (not in CI).
- **All tests:** `make test-games` and `make test-zx` (CI: `make ci` runs everything on chips and Spectrum emulators).

## Building from source

`build_cpc.sh` and `build_zx.sh` compile the shared game logic (`game.bas`, `main.bas`) with per-platform `platform_cpc.bas` and `platform_zx.bas`, then pack assets and binaries into disc images or .tap files.

**Build switches:** `-D DEMO` (attract mode, fixed seed), `-D SHOT=n` (screenshot after n logic steps, then end), `-D BENCH` (n steps, then print frame rate), `-D NODISC` (skip the disc load on Caprice32 — for chips, which has no disc), `-D BENCH_ERR` (with BENCH: report the frame count as "Error n", n = frames - 400, instead of PRINT; for bare 6128 benchmarks, where the text code would not fit below &4000). `BARE=1 tests/bench.sh chips` benches the bare builds. A bare program carries a little more than a firmware one (the boot and interrupt handler; Starfall never PRINTs, so it carries no font): see `build_cpc.sh`'s size report.

See [DESIGN.md](DESIGN.md) for the portable layer, asset pipeline and Arkos Tracker integration.
