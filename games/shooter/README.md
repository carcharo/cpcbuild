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
| **CPC 464** | 464 (`-D CPC464`) | `build_cpc.sh` | `starfa64.bin` on the same disc | Music in main RAM (tight) | No | &0040 |
| **Spectrum 128K** | 128 (`-D ZX128`) | `build_zx.sh 128` | `starfall128.tap` | Yes (IM2 hook) | Yes (bank 7) | &7C00 |
| **Spectrum 48K** | 48 (`-D ZX48`) | `build_zx.sh 48` | `starfall48.tap` | No | No | &8000 |

**Disc loader:** One AMSDOS disc (build/starfall.dsk) with all three CPC builds. Run `RUN"DISC` — the Z80 loader detects the 6128's extra RAM and boots the appropriate build.

## Build and run

### CPC (Caprice32 or real hardware)

```bash
cd games/shooter
bash build_cpc.sh        # generates build/starfall.dsk
cd ../..
make run PROG=games/shooter/build/starfall.dsk
```

Or run the disc in Caprice32 or a real CPC: load build/starfall.dsk, then `RUN"DISC`.

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

Measured at 25 Hz logic rate (every two frames on the CPC, every frame on the Spectrum):

| Platform | Mode | Frame rate | CPU spare |
|----------|------|------------|-----------|
| CPC 6128 | Silent | 25.0 steps/s | ~27 % |
| CPC 6128 | With music + effects | 25.0 steps/s | 0 % (packed in game mode) |
| CPC 464 | With music (main RAM) | ~25.0 steps/s | ~30 % (no pacing) |
| Spectrum 128K | With music + effects | 24.2 steps/s | about 20 of 250 steps overrun (formation moves) |
| Spectrum 48K | Silent | 25.0 steps/s | ~47 % |

**Game mode:** CPC builds use game mode to reclaim the ~11 % CPU cost of the firmware's interrupt handler. With game mode on, both CPC builds hit 25.0 steps/s even with music and effects. Game mode is opt-in in the Phase 5b framework; Starfall uses it by default for CPC.

**Spectrum 128K limits:** The music player owns the AY and its CPU cost (about 5 %) combined with graphics and collision detection leaves little margin. Strategies to hit 25.0 Hz: cheaper sprites (already custom), cheaper player logic, or trim peak formation steps (currently 20 of the 250-step budget during row entry).

## Known limits

- **Spectrum 128K at 24.2 steps/s:** most steps fit the two-frame budget, but about 20 of 250 (formation moves and similar peaks) take a third frame; the Arkos player costs about 0.2 frame per step. Options: a cheaper player, or trimming the peak steps.
- **Memory:** CPC 6128 ends 1.5 KB below &4000 (with double buffering); the extra RAM bank holds the music. Tighter changes (more enemies, larger sprites) would require single buffering or code reorganisation.
- **Sprites:** Both CPC and Spectrum use custom sprite routines (CPC: the cpcbuild library didn't fit below &4000 at 20.5 KB; Spectrum: Boriel's maskedsprites took 2.3 frames for 25 sprites). Folding them into the libraries is a follow-up phase.

## Tests

- **102 logic checks:** collision, scoring, formation steps, wave speed-up, lives and game over, on all four builds.
- **Screenshot goldens:** CPC 6128 and 464: title and a gameplay frame each; Spectrum 48K and 128K: title, an attract-mode gameplay frame and a started game each, plus the layer test scene.
- **Disc test:** loads and runs the CPC disc loader on Caprice32 (not in CI; runs manually with `make run`).
- **All tests:** `make test-games` and `make test-zx` (CI: `make ci` runs everything on chips and Spectrum emulators).

## Building from source

`build_cpc.sh` and `build_zx.sh` compile the shared game logic (`game.bas`, `main.bas`) with per-platform `platform_cpc.bas` and `platform_zx.bas`, then pack assets and binaries into disc images or .tap files.

**Build switches:** `-D DEMO` (attract mode, fixed seed), `-D SHOT=n` (screenshot after n logic steps, then end), `-D BENCH` (n steps, then print frame rate), `-D NODISC` (skip the disc load on Caprice32 — for chips, which has no disc).

See [DESIGN.md](DESIGN.md) for the portable layer, asset pipeline and Arkos Tracker integration.
