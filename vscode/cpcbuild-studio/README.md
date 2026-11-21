# CPC Game Studio

Tools for writing Amstrad CPC and CPC Plus programs in CPC BASIC from VS Code: palette, sprite, tile set and map
editors, a sound-effects editor and a music tracker, an image importer, build and run, CPC BASIC language support with a
library-aware linter and hover, and a symbol, register and memory view that follow a program running in the CPC Game
Studio Emulator.

CPC Game Studio is the VS Code front end of [CPCBuild](https://github.com/carcharo/cpcbuild), the Amstrad CPC toolchain.
**CPC BASIC** is its language (Locomotive BASIC 1.1 with typed `SUB`s and `FUNCTION`s, arrays, inline Z80 and includes) and
**`cpcbas`** its compiler, from [carcharo/cpcbas](https://github.com/carcharo/cpcbas). CPC BASIC is compatible in spirit
with Locomotive BASIC 1.1; its modern features and parts of its code generator are derived from Boriel BASIC 1.19
(AGPL-3.0); the runtime library is MIT.

## Requirements

- **VS Code 1.90 or later.** Nothing else is needed to build: the compiler runs inside this extension, so there is no
  Python, no Node.js to install and no compiler to download.
- **The CPCBuild library** (`lib/`) is bundled in this extension. The image, map, cartridge and music converters are built in.
- Optional: the **CPC Game Studio Emulator** extension (`cpcbuild.cpcbuild-emu`) to run in an editor tab and debug
  (**CPC Game Studio: Install Emulator** downloads it); Caprice32, CPCEC or Retro Virtual Machine as external emulators;
  the Arkos Tracker command-line tools for music (**CPC Game Studio: Download Tools** fetches Arkos Tracker 3.7 and checks
  it against a known checksum); Tiled for maps.
- Only for developers: Python 3 (with Pillow) for `cpcbuild.assets.engine: "python"`.
- The CPCBuild SDK folder from the [Releases page](https://github.com/carcharo/cpcbuild/releases) is optional: it holds the
  docs, examples and the games, and the compiler for command-line use (`node bin/cpcbas.mjs`, Node.js 22).

The **Get started with CPC Game Studio** walkthrough (**Welcome: Open Walkthrough...**) goes through the emulator, a new
project and the first build.

Right-click on a `.dsk` in a project: **Run in Emulator** types `RUN"` with the disc name from `cpcbuild.json` when
the disc is a target's output, else with the only `.BIN` or `.BAS` in the disc's catalogue (it asks when there are several).

Run **CPC Game Studio: Check Environment** to see what is found and what to set.

## Features

- **Projects**: `cpcbuild.json` describes targets (CPC firmware, bare metal, Plus cartridge) and asset globs;
  **CPC Game Studio: New Project** makes one from a template. Build, Build and Run and a `cpcbuild` task type compile with
  `cpcbas` inside the extension and report errors and warnings in the Problems panel.
- **CPC BASIC in the editor**: syntax highlighting and snippets, and the compiler's errors and warnings as you type.
- **Convert Project to CPC BASIC** turns a 0.1.x (Boriel BASIC) project into CPC BASIC: it shows a report of what it would
  change and writes only after you say yes. See [Coming from 0.1.x](#coming-from-01x).
- **Editors** for `.cpcpal` and `.cpcpal12` palettes, `.cpcspr` sprites, `.cpctil` tile sets, `.cpcimp` image
  import recipes and a viewer for Tiled `.tmx` maps. Each writes the same `.bas` the command-line tools write
  (`tools/img2cpc.py`, `tools/tmx2bas.py`), on save if you like.
- **Image importer**: PNG, GIF or BMP to a sprite, tile or screen asset, with a live preview of what the CPC shows.
- **Music**: convert Arkos Tracker songs and effect banks, and play them through the real player. The **music tracker**
  (`.cpcsong`, **CPC Game Studio: New Song**) edits a three-channel song with instruments you can draw, plays it through a
  model of the AY chip, and builds it into an include for the player.
- **Sound effects editor** for `.cpcsfx` banks (**CPC Game Studio: New Sound Effects Bank**): up to 9 effects, each
  drawn as pitch, volume and noise over time or made from a preset (blip, jump, coin, laser, hit, explosion, door,
  alarm). Space plays the effect at once through a model of the AY sound chip; **Play in emulator** plays it
  through the real player. Builds convert the bank with the Arkos tools into `NAME.bas`, with a constant per effect such
  as `SFX_JUMP`.
- **Language help** for the CPCBuild library in `.bas` files: lint rules, hover, completion and signature help.
- **Debugging** with the CPC Game Studio Emulator: symbols from the compiler map, registers, breakpoints, a memory view.

## Coming from 0.1.x

CPCBuild 0.1.x compiled Boriel BASIC with a fork of that compiler; 0.2.0 compiles CPC BASIC with `cpcbas`. For a 0.1.x
project:

1. Commit it, then run **CPC Game Studio: Convert Project to CPC BASIC** and answer that it is a 0.1.x project.
2. Read the report. Findings W720 to W725 stop the build until you fix them by hand; the others are places where valid CPC
   BASIC means something different from what the old program meant. Say yes to write the files, and yes again to remove
   the Spectrum targets from `cpcbuild.json` (they are gone in 0.2.0).
3. If your workspace set the old compiler options, Studio shows a message once with the translation to
   `cpcbuild.compiler.args`. The migration note linked below names the old setting.

The same translator is `cpcbas migrate` on the command line. The 0.1.2 release and the `v0.1.2` tag stay available for
projects that need the old compiler or the Spectrum targets. Details:
[docs/migrating-from-0.1.md](https://github.com/carcharo/cpcbuild/blob/main/docs/migrating-from-0.1.md).

## Settings

Everything is under `cpcbuild.*`; **CPC Game Studio: Open Settings** lists them. The main ones:

| Setting | Meaning |
| --- | --- |
| `cpcbuild.compiler.args` | Options for the compiler, as on the `cpcbas` command line: `-O 0\|1\|2\|3\|s`, `--heap N`, `--heap-address N`, `--org N`, `-D NAME[=VALUE]`, `-I DIR`, `-W CODE`, `-Werror`, `-Wimplicit`, `--opt-disable NAMES` |
| `cpcbuild.build.org`, `cpcbuild.build.outputDir` | The default `--org` for CPC targets (a target's own `org` wins), and the folder for `.bin`, `.map`, `.dsk` and `.cpr` files |
| `cpcbuild.sdk.path` | The SDK folder (the one holding `bin/cpcbas.mjs` and `lib/`); empty means look at or above the project. Studio does not need it to build |
| `cpcbuild.python.path` | Python 3 (only for the Python engine) |
| `cpcbuild.library.path` | A cpcbuild checkout, needed only by the Python engine. The BASIC library itself is always the one inside the extension |
| `cpcbuild.run.emulator` | `emu`, `caprice32`, `cpcec`, `rvm` or `custom` |
| `cpcbuild.target.default` | Target used when none was chosen; **CPC Game Studio: Select Target** remembers its choice per project in the workspace state, not in settings |
| `cpcbuild.assets.engine`, `cpcbuild.assets.generateOnSave` | Importer engine (built in or Python); write the `.bas` when a document is saved |
| `cpcbuild.lint.enable`, `cpcbuild.lint.rules` | Library lint |

## Workspace Trust

In a workspace you have not trusted (Restricted Mode) the editors and viewers open, but nothing that starts a
program runs: Build, Run, Regenerate Assets and generate-on-save, Convert and Play Music, Open in Tiled and the
tool checks of Check Environment. The settings that name programs or paths are ignored, and so is the `library`
field of `cpcbuild.json`, until you trust the workspace. Paths inside recipes and documents (sources, outputs,
palette files) must stay inside the project folder.

## Licence

The CPC Game Studio `.vsix` is a combined work under the GNU AGPL v3.0 or later: it bundles the `cpcbas` compiler. The
Studio's own sources are MIT (see `LICENSE`, which has both texts), and so is the bundled runtime library, which includes
Julien Nevo's Arkos Tracker player (MIT, `bundled/lib/music/LICENSE.arkos`). Icons are the extension's own; the webviews use
[@vscode/codicons](https://github.com/microsoft/vscode-codicons) (CC BY 4.0 / MIT).
