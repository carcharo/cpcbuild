# Caprice32 (patched, for the Plus tests)

`fetch_build.sh` downloads Caprice32 (Colin Pitrat, **GPLv2**,
github.com/ColinPitrat/caprice32) at the pinned commit `6c12c4c`, applies
`caprice32-asic-regs.patch` and builds `cap32` into the git-ignored `work/src/`
(`make cap32`). We do not vendor Caprice32: the repo holds only this script and
the patch (GPLv2 like Caprice32, 2 files, 7 lines changed plus 1 added). Caprice32 stays
a separate program run as a subprocess. If the pin is moved (also in
`.github/actions/setup/action.yml`) the patch may need rebasing; the script
stops with an error if it does not apply.

## Why

On a CPC Plus the ASIC registers (sprites, palette, DMA, `&6C00`-`&6C0F`) live
in a 16 KB register page that can be mapped over `&4000-&7FFF`. Caprice32 keeps
that page in a buffer (`pbRegisterPage`), but writes the DMA address,
prescaler and DCSR registers (`&6C00-&6C0B`, `&6C0F`) through `membank_write[]`,
i.e. into whatever is mapped at `&4000`. With the ASIC page out that is
program RAM: every raster interrupt ORs `&80` into `&6C0F` (`crtc.cpp`) and
every DMA cycle rewrites `&6C00-&6C0B`/`&6C0F` (`asic.cpp`). Code or data that
happens to sit there is corrupted. Starfall Plus crashed this way at one
memory layout (PRINT's CR routine hit), so the Plus tests passed or failed
depending on where the linker put things.

The patch reads and writes those registers in `pbRegisterPage` instead.
Behaviour with the ASIC page mapped in is unchanged.

## Use

```
make cap32                          # or: sh tools/caprice32/fetch_build.sh
```

Needs git, make, a C++ compiler, pkg-config, SDL2, FreeType, libpng and zlib
(macOS: `brew install sdl2 freetype libpng pkg-config`; Debian/Ubuntu:
`apt-get install g++ make pkg-config libsdl2-dev libfreetype6-dev zlib1g-dev libpng-dev`).
On macOS the script builds with `ARCH=macos APP_PATH=<work/src>`.

`tools/cpcrun.py` (and so every test runner), `games/shooter/tests/disc.py`
and `bench/bench.py` use `tools/caprice32/work/src/cap32` when it exists, else
`../caprice32/cap32` with a warning that it is unpatched. `CAP32=/path/to/cap32`
overrides both. The stock `../caprice32` build still works for everything except
Plus programs that keep code or data at `&6C00-&6C0F` (and `make test-plus`
may then fail depending on layout).
