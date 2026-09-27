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

## Recommendations in use (see cpc-port-notes.md §5–§6)

- Registers (§6.1), recommended: a firmware gate that restores BC' from a
  shadow on every call; interrupts only inside firmware calls in Phase 2–3,
  then an own IM1 front-end at &0038 before music (Phase 4d/5b).
- Memory map (§6.2), recommended: ORG &1000; fixed heap top-aligned under a
  1 KB private block at &9E00; 1 KB stack with SP = &A600; &A67B is the top.
- FP calculator on RST 6 (&0030) with `rst 30h` copies of 25 files (Q1).
