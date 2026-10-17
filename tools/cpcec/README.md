# CPCEC (second Plus emulator)

`fetch_build.sh` downloads CPCEC (César Nicolás-González, **GPLv3**, via the
cpcitor mirror) at a pinned commit, applies `cpcbuild.patch` and builds it into
the git-ignored `work/` directory (`make cpcec`). We do not vendor CPCEC's
source or ROMs: the repo holds only this script and our patch (`cpcbuild.patch`,
GPLv3 like CPCEC, 3 files, about 130 added lines). CPCEC stays a separate
program that we run as a subprocess; our own code (`tools/cpcrun.py` and the
test runners) is not derived from it. If the pin is moved the patch has to be
rebased; the script stops with a clear message when it no longer applies.

Run a cartridge by hand with `work/cpcec -m3 FILE.cpr` (`-m3` = 6128 Plus).
Without our options CPCEC behaves as upstream.

## What the patch adds (all long options, all inert unless given)

| option | effect |
| --- | --- |
| `--headless` | SDL dummy video and audio drivers (unless `SDL_VIDEODRIVER`/`SDL_AUDIODRIVER` are set), no window, no sound, no real-time delays (every frame is still rendered), no status text in the picture, and no `.cpcecrc` read or written (so the user's settings, palette and last-loaded files cannot change a run) |
| `--printer FILE` | record the CPC printer port into FILE from the start (the printer is also reported ready, as a real one) |
| `--shot-dir DIR` | a printer line `\x04SHOT name\n` saves the displayed frame as `DIR/name.png` two frames later |
| `--shot FILE` / `--shot-at N` | save the screen as PNG when the run ends, or at frame N (the run goes on) |
| `--max-frames N` | quit after N emulated frames, exit status 3 (the safety net) |
| `--end-on-marker` | quit three frames after the printer receives `\x04END\n` |
| `--no-config` | the config-file part of `--headless` on its own |

Where it hooks in: `cpcec-cb.h` (new: the option parser and a per-frame hook),
`cpcec.c` (include, `cb_args()` before `session_prae()`, the printer byte
callback, the per-frame call before `session_update()`, quit test in the main
loop, exit status), `cpcec-rt.h` (the PNG saver takes an exact path; skip the
frame-rate delay; skip the config file). PNGs come from CPCEC's own screenshot
code (768x536 RGB with border on the Plus).

`tools/cpcrun.py --emu cpcec` uses these; `make test-cpcec` runs the Plus
smoke tests, conformance (firmware and `--bare`) and screenshots on it.
Goldens are in `tests/screens/golden/cpcec-plus/`, separate from Caprice32's
(CPCEC's 12-bit colour conversion is brighter by design).

## The SDL-free WebAssembly build (Phase 8, `wasm/`)

`wasm/build.sh` is the R8 spike (CPCEC unchanged, SDL2 + ASYNCIFY, runs in a browser tab
by itself). `wasm/build-host.sh` is the build cpcbuild-emu ships: it replaces CPCEC's SDL2
front end with `wasm/cpcec-wasm.h` (frame buffer, audio buffer and keyboard map in plain
memory, no window, menus or dialogs) and turns `main()`'s loop into one callable
`cpcec_frame()` (`wasm/host.patch`, applied on top of `cpcbuild.patch`'s tree). The host
drives it through the `emu_*` exports of `wasm/cpcec-wasm-api.h` (API version 1; the list
is in that file's comments): `emu_init(model)`, `emu_load(path, kind)`, `emu_frame()`,
`emu_framebuffer()`/`emu_rgba()`, `emu_audio(ptr)`, `emu_key(cpc_key, down)`, `emu_reset()`,
and the debugger (`emu_peek/poke/regs/break/step/step_over/step_out`). It needs no browser:
`vscode/cpcbuild-emu/test/golden.mjs` runs it in Node and compares its pictures with the
goldens of `make test-cpcec`, pixel for pixel. Like the rest of this directory it is GPLv3,
derived from CPCEC (C) Cesar Nicolas-Gonzalez.

    make cpcec                                          (fetch + patch + build native CPCEC)
    EMSDK=/path/to/emsdk sh tools/cpcec/wasm/build-host.sh
    cd vscode/cpcbuild-emu && npm run test:golden
