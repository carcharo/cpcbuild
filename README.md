# CPCBuild

CPCBuild is an Amstrad CPC toolchain built on Boriel BASIC — a `--arch cpc` compiler backend (in the zxbasic fork, branch `cpc-arch`) plus the `cpcbuild` platform library, asset tools and test tooling. It is modelled on the Spectrum Next's NextBuild.

## Status

**Done:**
- Compiler backend: `--arch cpc` in the zxbasic fork (Phases 0-3: bootstrap, firmware gate, integers, floats, strings, arrays, DATA/READ).
- Text, input and graphics: PRINT/INK/PAPER/BORDER, INKEY$/INPUT, PLOT/DRAW/CIRCLE (4a); UDGs, fonts and SCREEN$ (4b).
- The `cpcbuild` library: screen addressing, double buffering, sprites (plain and masked), tiles and tile maps, fills, keyboard matrix scan, palettes. Written clean-room, MIT (4c).
- Asset pipeline: `img2cpc.py`, `tmx2bas.py` (4c).
- Interrupts always on through our own &0038 handler, firmware sound without blocking, AY register access, the Play library (4d).
- A headless reference emulator on floooh/chips that runs the whole test suite (pre-5a).

**In progress:** Phase 5a — tests, CI, documentation.

**Next:** Phase 5b — music player (Arkos Tracker 2) and opt-in game mode (interrupt-driven frame hook, for games that don't need the firmware's background sound queue or key buffer).

**Supported models:** Amstrad CPC 464, 664, 6128. The runtime is firmware-first (text, graphics, sound and files go through the jumpblock at &BB00-&BDxx); the `cpcbuild` library drives the screen, keyboard and palette directly for speed. CPC Plus features are planned for Phase 7.

## Screenshot

A tiled background (8×8 mode-0 tiles, 16-colour palette) with eight masked sprites bouncing, double-buffered at 25 updates per second (a new frame every other 50 Hz screen refresh).

![bounce demo](docs/images/bounce.png)

Build the demo yourself: `make run PROG=examples/bounce.bas`

## Quick start

### Prerequisites

- macOS dev environment
- Python 3 + Pillow (`pip install Pillow`)
- Poetry (`pipx install poetry` or Homebrew)
- zxbasic fork checked out as `../zxbasic` on branch `cpc-arch` with `poetry install`
- Caprice32 built from source in `../caprice32` (needs SDL2, `brew install sdl2`; used for `make run` and `make test`)
- A C compiler for chipsrun, the headless runner used by `make test-chips` and CI (no other dependencies; `make chips` fetches and builds it)

### Commands

```bash
# Interactive: build and run a program in Caprice32
make run PROG=examples/bounce.bas

# Headless screenshot (PNG output)
make shot PROG=examples/bounce.bas DEFS="-D NOSOUND"

# Unit tests (img2cpc, tmx2bas)
make unit

# Conformance tests (Caprice32, all models)
make test-all

# CI runner (headless, chips emulator, 464 and 6128)
make test-chips

# Benchmark (bounce.bas, measures updates/sec)
make bench
```

### Measured speeds (bounce.bas, 8 balls, CPC 6128)

- Silent: 25.0 updates/sec
- With wall-hit sound effects: 22.3 updates/sec
- With blips + two-channel background tune: 20.0 updates/sec

Build switches: `-D BALLS=n` (1–8, default 8), `-D NOMUSIC`, `-D NOSFX`, `-D NOSOUND`.

## Repository layout

```
docs/                     # Documentation, library reference, notes and decisions
examples/                 # Demo programs (bounce.bas)
examples/assets/          # PNG and TMX sources for bounce.bas (built by make assets)
tests/                    # Test suite
  conformance/            # 30 conformance programs (language, graphics, sound)
  screens/                # Screenshot regression tests
  stress/                 # Interrupt load and timing verification
  tools/                  # Unit tests for asset converters
bench/                    # Benchmark suite and measurements
tools/                    # Asset pipeline and emulator runners
  img2cpc.py              # PNG to mode 0/1/2 sprites, tiles, maps, palettes (or Spectrum data)
  tmx2bas.py              # Tiled .tmx map to TileMap bytes
  build_assets.sh         # Rebuild all assets
  cpcrun.py               # Compile and run a test headlessly (Caprice32, or chips with --emu chips)
  chipsrun/               # Headless chips emulator runner (CI)
Makefile                  # Build targets (run, shot, test, bench, ci, etc.)
PLAN-boriel-cpc.md        # Implementation plan and architecture
```

## Documentation

- **[Library reference](docs/library.md)** — API for sprites, tiles, keyboard, palette, sound
- **[CPC target (zxbasic fork)](https://github.com/carcharo/zxbasic/blob/cpc-arch/docs/architectures/amstrad_cpc.md)** — memory map, screen modes, firmware gate, PRINT, floats
- **[PLAN-boriel-cpc.md](PLAN-boriel-cpc.md)** — design overview, standing decisions, CPC hardware facts
- **[docs/notes.md](docs/notes.md)** — phase milestones and decisions log
- **[docs/cpc-port-notes.md](docs/cpc-port-notes.md)** — implementation details per phase

## Emulator roles

| Emulator | Role | Notes |
|----------|------|-------|
| **Caprice32** | Day-to-day development and interactive testing (464/664/6128 all models, Plus phases) | Master reference for firmware behaviour |
| **chips (floooh)** | Automated CI reference on 464 and 6128 (chipsrun headless runner) | Cycle-stepped Z80, deterministic; runs conformance suite ~15x real-time |
| **Retro Virtual Machine** | Optional manual spot-check (Plus, Phase 7, or when emulators disagree) | Not required for current phases |

## Licence

This project and library routines are licensed under the MIT License (see [LICENSE](LICENSE)). The cpcbuild library routines (sprites, tiles, keyboard, etc.) are written clean-room and licensed MIT.

The asset tools (`img2cpc.py`, `tmx2bas.py`) are MIT.

The chips emulator used in CI is licensed under the zlib/libpng licence (see `tools/chipsrun/LICENSE.chips`).

---

**Getting started:** Read [PLAN-boriel-cpc.md](PLAN-boriel-cpc.md) for the design and [docs/library.md](docs/library.md) for the API. Build and run the bounce demo with `make run PROG=examples/bounce.bas`, then explore `examples/` or write your own.
