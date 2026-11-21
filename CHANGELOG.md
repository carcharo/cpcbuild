# Changelog

## 0.2.0

CPCBuild now compiles CPC BASIC with its own compiler, `cpcbas`, instead of a fork of Boriel BASIC. Programs, the
library and the tools are for the Amstrad CPC only. A 0.1.x project needs one conversion step: see
[docs/migrating-from-0.1.md](docs/migrating-from-0.1.md).

### Language and compiler

- **CPC BASIC**: Locomotive BASIC 1.1 as you know it, with typed `SUB` and `FUNCTION`, arrays, inline Z80, includes and the
  other features that make compiled games fast. The compiler, `cpcbas`, is its own project:
  [carcharo/cpcbas](https://github.com/carcharo/cpcbas). CPCBuild pins the version it builds with in `cpcbas.json`.
- The language follows Locomotive BASIC where Boriel BASIC did not: `AND`, `OR` and `NOT` are bitwise, a comparison is -1 when
  true, `PRINT` and `STR$` put the sign space in front of a number, hex numbers are `&FF`, and `MODE`, `FRAME`, `PEN`,
  `PAPER`, `INK`, `SOUND` and the rest are statements of the language. `docs/keywords.md` in the SDK is the reference.
- The runtime library (`#include <cpcbuild.bas>` and the files below it) now lives in the cpcbas repository. Its calls are the
  same; some parameters are renamed, `Mode n` is `MODE n` and `WaitVsync` is `FRAME`. The calls that the language replaced
  (`Play`, `SetFont`, `POINT`, `SCREEN$` and `INPUT` as library files) are gone. [docs/library.md](docs/library.md) is the
  reference.
- `cpcbas migrate` translates a 0.1.x project to CPC BASIC and lists what it could not rewrite by itself.
- The examples, Lamplighter, Starfall and the benchmarks are translated to CPC BASIC.

### CPC Game Studio

- **The compiler runs inside the extension.** Build and Build and Run need no Python, no Poetry and no compiler download.
  **Download Tools** now fetches only the Arkos Tracker tools for music. The compiler's options go in
  `cpcbuild.compiler.args` (the `cpcbas` command line); the old `cpcbuild.zxbc.*` settings are not read any more, and Studio
  offers the translation of `cpcbuild.zxbc.args` once.
- **CPC BASIC in the editor**: syntax highlighting and snippets, and the compiler's errors and warnings as you type, in the
  Problems panel with the same messages the build gives.
- **Convert Project to CPC BASIC** runs `cpcbas migrate` over a project, shows the report, and writes only after you say
  yes; it can remove the Spectrum targets from `cpcbuild.json`.
- **Sound effects editor** (`.cpcsfx`, **New Sound Effects Bank**) and **music tracker** (`.cpcsong`, **New Song**): draw
  or write the sound, play it through a model of the AY chip, and build it into the include the music player reads.
- A restyled palette editor, sprite and tile editors, image importer, tile map viewer, memory view and emulator panel.

### SDK and releases

- One `.zip` for Windows, macOS and Linux (`cpcbuild-sdk-0.2.0.zip`) replaces the six per-platform archives. It holds the
  compiler as one file, `bin/cpcbas.mjs`, which needs Node.js 22 for command-line use only; Studio needs nothing but
  VS Code. The programs are no longer packaged executables, so there is nothing to sign or to quarantine on macOS and
  Windows.
- The release notes name the compiler version and commit, and `SOURCES.txt` in the SDK lists the sources it was built from.

### Removed

- The ZX Spectrum target: the `zx48k` build, the `.tap` package, the Spectrum sprite library, the Spectrum options of the
  asset tools, and the Spectrum editions of Lamplighter and Starfall. The 0.1.x releases still build them.
- The compiler download in Studio, and the `zxbasm` and `mkdsk` programs of the SDK: `cpcbas asm` and `cpcbas dsk` replace them.
- The `$zxbc` problem matcher (the compiler's diagnostics now reach Problems directly).

### Licences

- The compiler is AGPL-3.0-or-later, and the CPC Game Studio `.vsix`, which bundles it, is a combined work under the same
  licence (its own sources stay MIT). The runtime library and the rest of CPCBuild are MIT; the emulator extension is
  GPL-3.0-or-later. The credits for Boriel BASIC, from which parts of the compiler's code generator and the runtime library
  derive, are in `LICENSES/cpcbas-NOTICE.txt` in the SDK.

Earlier releases, 0.1.0 to 0.1.2, are on the [Releases page](https://github.com/carcharo/cpcbuild/releases).
