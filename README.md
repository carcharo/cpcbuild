# CPCBuild

CPCBuild is an Amstrad CPC toolchain built on Boriel BASIC — a `--arch cpc` compiler backend (in the zxbasic fork, branch `cpc-arch`) plus the `cpcbuild` platform library, asset tools and test tooling.

**CPC Game Studio** is the VS Code front end of CPCBuild: project templates, palette, sprite and tile editors, an image importer, build and run, and an emulator tab with a debugger. It is two extensions, `cpcbuild-studio` and `cpcbuild-emu`, in `vscode/`.

## Status

Version 0.1.2 is released: the two VS Code extensions and ready-to-run SDK folders for Windows, macOS and
Linux, on the [Releases page](https://github.com/carcharo/cpcbuild/releases).

**Compiler and runtime**
- `--arch cpc` in the zxbasic fork: integers, floats, strings, arrays, DATA/READ; PRINT/INK/PAPER/BORDER,
  INKEY$/INPUT, PLOT/DRAW/CIRCLE, UDGs, fonts and SCREEN$.
- Firmware mode (the default) goes through the firmware jumpblock for text, graphics, sound and files, with
  interrupts always on through our own &0038 handler.
- Bare-metal mode (`-D CPC_BAREMETAL`) never calls the firmware: the runtime boots the machine and does its own
  text, keyboard, sound and graphics, pixel-identical to firmware mode, with 6656 bytes more room (up to &B7FF).
  It also starts from a cold machine, which is how cartridges run. See the compiler's
  [Bare-metal mode](https://github.com/carcharo/zxbasic/blob/cpc-arch/docs/architectures/amstrad_cpc.md#bare-metal-mode)
  section.

**The `cpcbuild` library** (clean-room, MIT; [docs/library.md](docs/library.md))
- Screen addressing, double buffering, sprites (plain and masked), tiles and tile maps, fills, keyboard matrix
  scan, palettes, extra RAM banks on the 6128.
- Sound: AY register access, the Play library, the Arkos Tracker 3 music player, sound effects, an opt-in game
  mode.
- CPC Plus: 16 hardware sprites, the 12-bit palette, soft scroll and split screen, raster interrupts (bare-metal
  only), DMA sound, cartridges (`.cpr`).

**Tools**
- **CPC Game Studio** for VS Code: project templates, build and run, palette, sprite and tile editors, an image
  importer, a Tiled map viewer, music conversion, language help, and an emulator tab (CPCEC compiled to
  WebAssembly) with a debugger.
- Command-line asset tools: `img2cpc.py`, `tmx2bas.py`, `aks2bas.py`, `mkcpr.py` ([art guide](docs/art-guide.md)).
- Tests: language conformance and screenshot comparisons in firmware and bare-metal modes, on a headless
  emulator built on floooh/chips (464, 6128) and on Caprice32 and CPCEC (6128 Plus), all in CI.

**Games**
- **Lamplighter**, a flip-screen platformer, and a [tutorial](docs/tutorial/README.md) that builds it chapter by
  chapter in plain BASIC, measures it, then brings in six assembly routines. Builds for the CPC 464 and 6128,
  the Spectrum 48K and 128K, and the CPC Plus.
- **Starfall**, a single-screen shooter for the CPC 6128 and 464 (firmware and bare-metal builds), the Spectrum
  128K and 48K, and a CPC Plus cartridge with a multiplexed hardware-sprite formation.

**In progress:** a sound-effect editor in Studio.

**Supported models:** Amstrad CPC 464, 664 and 6128, and the CPC Plus range (6128 Plus; GX4000 cartridges). Both
games also build for the ZX Spectrum from the same BASIC source, through Boriel BASIC's own Spectrum target.

## Install

The current version is 0.1.2. Everything is on the
[Releases page](https://github.com/carcharo/cpcbuild/releases). You need [VS Code](https://code.visualstudio.com/)
(on Linux with an ARM processor, see the note for Linux below). You do not need Python.

Pick one route.

### Route A: the two extensions

1. From the Releases page, download `cpcbuild-studio-0.1.2.vsix` and `cpcbuild-emu-0.1.2.vsix`.
2. In VS Code, open the Command Palette (Ctrl+Shift+P; Cmd+Shift+P on macOS) and run
   **Extensions: Install from VSIX...**. Do this once for each file.
3. Run **Welcome: Open Walkthrough...** and choose **Get started with CPC Game Studio**.
4. In the walkthrough, choose **Download Tools**. Studio asks what to download: the Boriel BASIC compiler
   1.19.0-cpc.2 (with `zxbasm` and `mkdsk`) and the Arkos Tracker 3.7 command-line tools (music conversion). It
   checks each download against a known checksum. You can run **CPC Game Studio: Download Tools** from the Command
   Palette later.
5. The walkthrough's next steps create a project from a template, then build and run it. When VS Code asks
   whether you trust the authors of the project folder, choose **Trust**: Studio cannot build in a folder VS Code
   does not trust. You can skip **Install Emulator**: it is for people who installed Studio without the emulator
   extension.

Run **CPC Game Studio: Check Environment** at any time to see what Studio found and what to fix.

### Route B: the SDK folder

The SDK is a ready-to-run folder with the compiler and tools (`bin/`), the library, the docs, the examples, the
Lamplighter game and both `.vsix` files. Download the one for your computer:

| Computer | File |
|---|---|
| Windows x64 | `cpcbuild-sdk-0.1.2-windows-x64.zip` |
| Windows on ARM | `cpcbuild-sdk-0.1.2-windows-arm64.zip` |
| Linux x64 | `cpcbuild-sdk-0.1.2-linux-x64.tar.gz` |
| Linux arm64 | `cpcbuild-sdk-0.1.2-linux-arm64.tar.gz` |
| macOS, Apple silicon | `cpcbuild-sdk-0.1.2-macos-arm64.zip` |
| macOS, Intel | `cpcbuild-sdk-0.1.2-macos-x64.zip` |

Unpack it anywhere, install the two `.vsix` files from inside it as in route A, and read `README-FIRST.txt`.
Studio finds the SDK by itself for any project inside the SDK folder. For a project somewhere else, set
`cpcbuild.sdk.path` to the SDK folder.

### Notes for each system

- **macOS.** The binaries are meant to be signed and notarised, but until that is set up they are unsigned. The
  first build from an SDK you downloaded in a browser may show **"zxbc" Not Opened** ("Apple could not verify
  "zxbc" is free of malware..."). Choose **Done**, not **Move to Bin**, then run
  `xattr -dr com.apple.quarantine <folder>` in Terminal on the unpacked SDK folder (type the command, then drag
  the folder into the window for its path) and build again. Unpack with Finder or `ditto -x -k`. Tools that
  Studio downloads itself are not affected.
- **Windows.** The binaries are unsigned. SmartScreen may warn about the SDK's programs: choose **More info**,
  then **Run anyway** (in our tests on Windows 11 it did not appear). Unpack with **Extract All** to a folder on a
  local drive, such as `C:\cpcbuild-sdk`. Tools that Studio downloads itself are not affected. Windows on ARM gets
  a native compiler; the Arkos tools run under Windows' x64 emulation.
- **Windows in a virtual machine** (Parallels, for example): folders shared from the host appear as network paths
  (`\\Mac\...`), and VS Code refuses to open files there ("UNC host ... access is not allowed"). Copy the `.vsix`
  files and keep your projects on the virtual machine's own drive.
- **Linux.** Unpack with `tar -xzf`, which keeps file permissions. On an ARM computer (a Raspberry Pi, an ARM
  laptop or virtual machine) VS Code's website offers the x64 `.deb` by default, which will not install: choose
  the **Arm64** `.deb` and install it in a terminal with `sudo apt install ./code_*_arm64.deb` (Ubuntu's App
  Center can hang on downloaded `.deb` files).

## Screenshots

**Starfall:** a single-screen shooter for CPC and Spectrum.

![Starfall on CPC 6128](docs/images/starfall-cpc-2x.png)
![Starfall on Spectrum 128K](docs/images/starfall-zx.png)

See [games/shooter/README.md](games/shooter/README.md) for how to play and build all four versions (CPC 6128/464, Spectrum 128K/48K).

**bounce.bas demo:** A tiled background (8×8 mode-0 tiles, 16-colour palette) with eight masked sprites bouncing, double-buffered at 25 updates per second (a new frame every other 50 Hz screen refresh).

![bounce demo](docs/images/bounce.png)

Build the demo yourself from a checkout: `make run PROG=examples/bounce.bas` (see [Developing CPCBuild](#developing-cpcbuild))

## Developing CPCBuild

This section is for working on CPCBuild itself. To use it, see [Install](#install).

### Prerequisites

- macOS or Linux. CI runs the `make` targets on Ubuntu; Windows is untested (WSL may work)
- Python 3 + Pillow (`pip install Pillow`), for the Python asset tools in `tools/` and the test scripts
- Poetry (`pipx install poetry` or Homebrew)
- zxbasic fork checked out as `../zxbasic` on branch `cpc-arch` with `poetry install` (the compiler the `make` targets use)
- Caprice32 built from source in `../caprice32`, or with `make cap32` (used for `make run` and `make test`). It needs
  SDL2, FreeType and libpng: on macOS `brew install sdl2 freetype libpng pkg-config`; on Debian/Ubuntu
  `sudo apt install g++ make pkg-config libsdl2-dev libfreetype6-dev zlib1g-dev libpng-dev`
- A C compiler for chipsrun, the headless runner used by `make test-chips` and CI (no other dependencies; `make chips` fetches and builds it)

### Commands

```bash
# Interactive: build and run a program in Caprice32 (keep its window visible:
# macOS throttles a hidden Caprice32, and its sound then stutters)
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

Normal mode: Silent 25.0 updates/sec, with wall blips 22.3, with blips and music 20.0.
Game mode: Silent 25.0, with effects 25.0, with effects and music 25.0 (CPU available elsewhere).

Build switches: `-D BALLS=n` (1–8, default 8), `-D NOMUSIC` (effects only), `-D NOSFX` (music only),
`-D NOSOUND` (silent), `-D GAMEMODE` (game mode on), `-D FWSOUND` (firmware sound), `-D BENCH`,
`-D SHOT=n` (screenshot after n updates).

## Repository layout

```
docs/                     # Documentation: library reference, tutorial, art guide
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
```

## Documentation

- **[Library reference](docs/library.md)** — API for sprites, tiles, keyboard, palette, sound, and [CPC Plus hardware](docs/library.md#10-cpc-plus-cpcplus)
- **[CPC target (zxbasic fork)](https://github.com/carcharo/zxbasic/blob/cpc-arch/docs/architectures/amstrad_cpc.md)** — memory map, screen modes, firmware gate, PRINT, floats
- **[Tutorial](docs/tutorial/README.md)** — build a complete game (Lamplighter) step by step
- **[Art guide](docs/art-guide.md)** — drawing sprites and tiles and getting them into a project

## Emulator roles

| Emulator | Role | Notes |
|----------|------|-------|
| **Caprice32** | Day-to-day development and interactive testing (464/664/6128 all models, Plus phases) | Master reference for firmware behaviour |
| **chips (floooh)** | Automated CI reference on 464 and 6128 (chipsrun headless runner) | Cycle-stepped Z80, deterministic; runs conformance suite ~15x real-time |
| **Retro Virtual Machine** | Optional manual spot-check (Plus, Phase 7, or when emulators disagree) | Not required for current phases |

## Licence

This project and library routines are licensed under the MIT License (see [LICENSE](LICENSE)). The cpcbuild library routines (sprites, tiles, keyboard, etc.) are written clean-room and licensed MIT.

The asset tools (`img2cpc.py`, `tmx2bas.py`) and the bounce demo are MIT.

The Arkos Tracker 3.7 music player (Phase 5b) is MIT, copyright (c) 2016-2025 Julien Nevo. See `lib/music/LICENSE.arkos`.

The chips emulator used in CI is licensed under the zlib/libpng licence (see `tools/chipsrun/LICENSE.chips`).

---

**Getting started:** [Install](#install) the extensions, follow the [tutorial](docs/tutorial/README.md) and keep [docs/library.md](docs/library.md) open for the API. To build the bounce demo from a checkout, see [Developing CPCBuild](#developing-cpcbuild).
