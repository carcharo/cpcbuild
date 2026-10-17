# Build Lamplighter: a CPCBuild tutorial

You are going to build a complete flip-screen platformer for the Amstrad CPC 464, one chapter at a
time, using Boriel BASIC and the CPCBuild tools in VS Code. At the end you will have a game you can
play on a CPC 464 or 6128, a Spectrum 48K or 128K, and (optionally) a CPC Plus.

> **Status: first draft.** The game and the library are finished and tested. The text below was
> written from the game's source and the tools' documentation; places where the text could not
> be checked against a running VS Code are marked in the Markdown source with HTML comments that start
> with the word CHECK.

## The game

**Lamplighter** climbs a dark tower at dusk. Every room has one to three unlit lamps. Touch a lamp
and it lights; light them all and the room's door opens. The tower has 12 rooms in a 3 x 4 grid
(28 lamps in all). You walk, jump, climb ladders and avoid spikes and three kinds of enemy. You
have three lives. Walk off the edge of a room and you flip to the next one.

![Room 9, the cellar, on a CPC 464](../../games/lamplighter/tests/golden/464/room09.png)

The finished source is in [`games/lamplighter/`](../../games/lamplighter/). You write your own copy
as you go, and compare with it at the end of each chapter.

## Who this is for

You know some BASIC (Locomotive BASIC on the CPC, Sinclair BASIC on the Spectrum, or similar) and
you want to write a real game. You do not need to know Z80 assembly, Boriel BASIC, or the CPCBuild
tools. If you have used NextBuild on the Spectrum Next, the workflow will feel familiar: CPCBuild
Studio's workflow is inspired by NextBuild Studio, though it shares no code with it.

## The chapters

| # | Chapter | You will | You will see |
|---|---|---|---|
| 1 | [A new project](01-new-project.md) | create a project from the template, build it, run it in the emulator tab | text bouncing on a CPC screen, and a Spectrum tape built from the same code |
| 2 | [Palette and tiles](02-palette-and-tiles.md) | bring in 16 pens and 16 tiles, draw one room with `TileMap` | the first room, in colour |
| 3 | [The tower](03-the-tower.md) | look at the 12-room map in Tiled and Studio's map viewer, cut it into rooms | all 12 rooms, flipping with two keys |
| 4 | [The player sprite](04-the-player-sprite.md) | draw a masked sprite, erase it with `TileRestore`, draw in flyback order | the lamplighter walking about |
| 5 | [Movement](05-movement.md) | add gravity, a jump, one-way platforms and ladders | a player who falls, jumps and climbs between rooms |
| 6 | [Enemies](06-enemies.md) | add walkers, floaters and bats | things that move and want to hurt you |
| 7 | [Lamps, doors, lives and the HUD](07-lamps-doors-lives-hud.md) | make it a game: lamps, doors, lives, title, win and game over | the whole game, silent |
| 8 | [Sound and music](08-sound-and-music.md) | add a tune and effects through `lib/music` | music and a jump sound |
| 9 | [Measuring](09-measuring.md) | read the build report, run the bench, hold 25 steps a second | numbers, and why they are what they are |
| 10 | [The Spectrum build](10-the-spectrum-build.md) | build the same game for the Spectrum 48K and 128K | two `.tap` files |
| 11 | [The 6128 and the Plus](11-6128-and-plus.md) (optional) | build for the 6128, then the CPC Plus with hardware sprites and flickering flames | a Plus cartridge |

Chapters 1 to 9 build up one program. Chapters 10 and 11 are separate builds of the same game and
can be done in either order, or skipped.

## What you need

| You need | For | Check with |
|---|---|---|
| VS Code | everything | |
| The **CPCBuild Studio** extension (`cpcbuild.cpcbuild-studio`) | editors, importer, build and run | the **CPCBuild** icon in the Activity Bar |
| The **CPCBuild Emulator** extension (`cpcbuild.cpcbuild-emu`) | running the game in an editor tab | **CPC Emulator: Open File...** in the Command Palette |
| The Boriel BASIC compiler with the CPC backend: the `zxbasic` fork, branch `cpc-arch` (`https://github.com/carcharo/zxbasic`) | compiling | `poetry run zxbc --version` in that folder |
| Python 3 | packaging the disc image | `python3 --version` |
| A cpcbuild checkout | the finished game to compare with, the art files, the library | `games/lamplighter/` exists |
| [Tiled](https://www.mapeditor.org/) (chapter 3) | editing the tower map | **CPCBuild: Open in Tiled** |

Tiled is optional: you can follow chapter 3 without editing, because the finished map is in the repo.
Chapter 11 needs a cpcbuild checkout newer than the library copy bundled inside the Studio extension
(the bundled copy lacks the Plus sprite manager and palette cycling; see that chapter), which is why
chapter 1 suggests setting `cpcbuild.library.path` from the start.

Both extensions come as `.vsix` files that `make vsix` builds in the cpcbuild repository
(`vscode/cpcbuild-studio/` and `vscode/cpcbuild-emu/`). Install each with the Command Palette
command **Extensions: Install from VSIX...**.
<!-- CHECK: how a hobbyist gets the two .vsix files today (Makefile "vsix" target builds them; no release page is mentioned in the sources). Replace this paragraph when there is a download. -->

## How the chapters work

Each chapter has the same parts:

- **Goal** and **What you'll learn**.
- **Steps**: things you do, with the exact command or editor, and the code to write.
- **Build and run**: a checkpoint. It says what you should see in the emulator tab.
- **How it works**: the library calls used, explained, with the section of
  [`docs/library.md`](../library.md) where they are documented (by name: look for it in the
  Contents or search the file).
- **Try this**: small exercises.

Conventions:

- **`file:line`** after a code block, for example `game.bas:413-431`, means "this comes from the
  finished game's file, at those lines". Line numbers refer to the files in
  `games/lamplighter/` on the `platformer` branch.
- Code marked **(simplified)** is a cut-down version of the real thing. The text says what was left out.
- Commands in the Command Palette (press `Ctrl+Shift+P`, or `Cmd+Shift+P` on a Mac) are written
  with the exact title, for example **CPCBuild: Build and Run**.
- Boriel BASIC variable names are case-insensitive; the game uses a mixture. Copy what you see.

### Where your files go

You will make one project folder, `lamplighter/`, like this:

```
lamplighter/
  cpcbuild.json              the project: targets and asset recipes
  assets/                    your source art and recipes (PNG, palette, Tiled map, .cpcimp)
  src/
    main.bas                 ties the layers together
    game.bas                 the rules: no drawing, no keys, no sound
    platform_cpc.bas         everything CPC-specific: screen, sprites, keys, sound
    platform_zx.bas          the Spectrum layer (chapter 10)
    assets/                  generated .bas files (and copied ones: songs, font)
```

The real game keeps its `.bas` files flat in `games/lamplighter/` with generated data in
`games/lamplighter/assets/`. Putting your `src/` beside an `assets/` folder is the Studio's layout,
so in this tutorial the generated files go to `src/assets/` and the source art stays in `assets/`.
That way `#include "assets/tiles.bas"` reads the same in your code and in the finished game.

### The art and data files you copy

Lamplighter's pictures were made by a Python script (`games/lamplighter/assets/make_art.py`) as PNG
files, so the tutorial starts from those PNGs rather than asking you to be an artist. You can also
draw everything in the Studio's editors; each chapter says how.

| Copy from `games/lamplighter/assets/` | Into | Used in |
|---|---|---|
| `lamp.pal`, `tiles.png`, `sprites.png` | `assets/` (rename `lamp.pal` to `lamp.cpcpal`) | chapter 2, 4 |
| `tower.tmx` | `assets/` | chapter 3 |
| `fontcpc.bas` | `src/assets/` | chapter 3 |
| `title.bas`, `gamesong.bas`, `sfx.bas`, `quiet.bas` | `src/assets/` | chapter 8 |
| `zx/zx_tiles.png`, `zx/zx_sprites.png`, `zx/sfx_zx.bas` | `assets/zx/`, `src/assets/zx/` | chapter 10 |
| `plus/plus_tiles.png`, `plus/plus_sprites.png`, `plus/pl_pens.bas` | `assets/plus/`, `src/assets/plus/` | chapter 11 |

### If something does not build

1. Run **CPCBuild: Check Environment**. It lists what it found and what is missing.
2. Open **View > Output** and choose **CPCBuild** in the drop-down: the compiler's messages are there.
3. Open the **Problems** panel: compiler errors and warnings appear there with file and line.
4. Compare your file with the finished one in `games/lamplighter/`.

## What the tutorial does not do

It does not write music (it reuses Starfall's songs; chapter 8 says where to go if you want your own), and it
does not use Studio's debugging views (symbols, registers, memory, breakpoints), which are worth exploring once
the game runs.
