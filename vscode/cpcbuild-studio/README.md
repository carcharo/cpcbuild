# CPCBuild Studio

Tools for writing Amstrad CPC and CPC Plus programs in Boriel BASIC (the `--arch cpc` backend) from VS Code:
palette, sprite, tile set and map editors, an image importer, build and run, a library-aware linter and hover,
and a symbol, register and memory view that follow a program running in the CPCBuild Emulator.

It is an independent project. Its workflow is inspired by NextBuild Studio for the ZX Spectrum Next; it
contains no code from it.

## Requirements

- **The Boriel BASIC compiler with the CPC backend**: the zxbasic fork (branch `cpc-arch`,
  `https://github.com/carcharo/zxbasic`), installed so that `zxbc --arch cpc` works. Set `cpcbuild.zxbc.command`
  and `cpcbuild.zxbc.cwd` if you start it through Poetry (`["poetry", "run", "zxbc"]`). With the default command
  and a `pyproject.toml` in `cpcbuild.zxbc.cwd`, Studio uses `poetry run zxbc` by itself when `zxbc` is not found
  (poetry on `PATH`, else `~/.local/bin/poetry`, or under `%APPDATA%` on Windows). The same checkout holds
  `tools/cpc/mkdsk.py`, which packages a `.dsk`. Point `cpcbuild.zxbc.cwd` at it. (`mkdsk.py` is licensed AGPL-3.0
  with the compiler, so it is not part of this extension.)
- **Python 3**, for `mkdsk.py`, `mkcpr.py` (Plus cartridges) and the optional Python image engine (which also
  needs Pillow).
- **The CPCBuild library** (`lib/`) and the converters in `tools/`. A copy is bundled in this extension and is
  used when nothing else is found; set `cpcbuild.library.path` to a cpcbuild checkout to use your own.
- Optional: the **CPCBuild Emulator** extension (`cpcbuild.cpcbuild-emu`) to run in an editor tab and debug;
  Caprice32, CPCEC or Retro Virtual Machine as external emulators; the Arkos Tracker command-line tools for music;
  Tiled for maps.

Right-click on a `.dsk` in a project: **Run in Emulator** types `RUN"` with the disc name from `cpcbuild.json` when
the disc is a target's output, else with the only `.BIN` or `.BAS` in the disc's catalogue (it asks when there are several).

Run **CPCBuild: Check Environment** to see what is found and what to set.

## Features

- **Projects**: `cpcbuild.json` describes targets (CPC firmware, bare metal, Plus cartridge) and asset globs;
  **CPCBuild: New Project** makes one from a template. Build, Build and Run and a `cpcbuild` task type use the
  `$zxbc` problem matcher.
- **Editors** for `.cpcpal` and `.cpcpal12` palettes, `.cpcspr` sprites, `.cpctil` tile sets, `.cpcimp` image
  import recipes and a viewer for Tiled `.tmx` maps. Each writes the same `.bas` the command-line tools write
  (`tools/img2cpc.py`, `tools/tmx2bas.py`), on save if you like.
- **Image importer**: PNG, GIF or BMP to a sprite, tile or screen asset, with a live preview of what the CPC shows.
- **Music**: convert Arkos Tracker songs and effect banks, and play them through the real player.
- **Language help** for the CPCBuild library in `.bas` files: lint rules, hover, completion and signature help.
- **Debugging** with the CPCBuild Emulator: symbols from the compiler map, registers, breakpoints, a memory view.

## Settings

Everything is under `cpcbuild.*`; **CPCBuild: Open Settings** lists them. The main ones:

| Setting | Meaning |
| --- | --- |
| `cpcbuild.zxbc.command`, `cpcbuild.zxbc.cwd`, `cpcbuild.zxbc.args` | How to start the compiler, where, and extra arguments |
| `cpcbuild.python.path` | Python 3 |
| `cpcbuild.library.path` | A cpcbuild checkout (empty: search upwards, then the bundled copy) |
| `cpcbuild.run.emulator` | `emu`, `caprice32`, `cpcec`, `rvm` or `custom` |
| `cpcbuild.run.zxEmulator`, `cpcbuild.run.zxEmulatorArgs` | An external Spectrum emulator (Fuse, ZEsarUX, ...) that Build and Run starts on the `.tap` of a `zx48k` target; `${file}` is the `.tap` |
| `cpcbuild.target.default` | Target used when none was chosen; **CPCBuild: Select Target** remembers its choice per project in the workspace state, not in settings |
| `cpcbuild.assets.engine`, `cpcbuild.assets.generateOnSave` | Importer engine (built in or Python); write the `.bas` when a document is saved |
| `cpcbuild.lint.enable`, `cpcbuild.lint.rules` | Library lint |

## Workspace Trust

In a workspace you have not trusted (Restricted Mode) the editors and viewers open, but nothing that starts a
program runs: Build, Run, Regenerate Assets and generate-on-save, Convert and Play Music, Open in Tiled and the
tool checks of Check Environment. The settings that name programs or paths are ignored, and so is the `library`
field of `cpcbuild.json`, until you trust the workspace. Paths inside recipes and documents (sources, outputs,
palette files) must stay inside the project folder.

## Licence

MIT (see `LICENSE`). The bundled `lib/music/` player is Julien Nevo's Arkos Tracker player, MIT
(`bundled/lib/music/LICENSE.arkos`). Icons are the extension's own; the webviews use
[@vscode/codicons](https://github.com/microsoft/vscode-codicons) (CC BY 4.0 / MIT).
