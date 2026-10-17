# Chapter 1: A new project

**Goal.** Create a CPCBuild project from the Studio's template, build it, run it in an emulator tab
inside VS Code, break it on purpose to see how errors show up, and build a Spectrum tape from the
same code. By the end you know the edit, build, run loop that every later chapter uses.

**What you'll learn**

- How to check that the compiler, Python and the library are found.
- What a CPCBuild project is: `cpcbuild.json`, targets, and the `build/` folder.
- Why Lamplighter is split into `main.bas`, `game.bas` and `platform_cpc.bas`.
- A few things that are different between Locomotive BASIC and Boriel BASIC.

**Time:** about 20 minutes, most of it installing.

---

## Step 1: Install the two extensions

Install **CPCBuild Studio** and **CPCBuild Emulator** from their `.vsix` files (see the
[README](README.md#what-you-need)): open the Command Palette and run
**Extensions: Install from VSIX...**, once for each file.

You should now see a **CPCBuild** icon (a chip) in the Activity Bar on the left. It stays empty until
you open a project.

The two extensions are separate on purpose. Studio does the editing, building and debugging.
The Emulator extension is the CPC in a tab. They talk only through VS Code commands, and Studio
works without the emulator: it can start Caprice32, CPCEC or Retro Virtual Machine as an external
program instead (the `cpcbuild.run.emulator` setting, step 6).

## Step 2: Tell Studio where the compiler is

Studio runs the Boriel compiler for you, and the CPC backend lives in the `zxbasic` fork. Open
**Settings** (`Ctrl+,`) and search for `cpcbuild`, or run **CPCBuild: Open Settings**. Set:

| Setting | Value |
|---|---|
| `cpcbuild.zxbc.command` | `["poetry", "run", "zxbc"]` |
| `cpcbuild.zxbc.cwd` | the path of your `zxbasic` checkout (branch `cpc-arch`) |
| `cpcbuild.library.path` | the path of your cpcbuild checkout (the folder that contains `lib/` and `tools/`) |

The first two are the ones Studio's own documentation gives for the Poetry setup. The third is
optional: with it empty Studio uses a copy of the library bundled inside the extension. Chapters 1 to
10 work with the bundled copy, but chapter 11 needs a newer one, so setting it now saves trouble.
The `cpcbuild.zxbc.cwd` folder is also where Studio looks for `mkdsk.py`, the tool that packages a disc image.

> **Tip.** If you prefer editing `settings.json`: the keys are exactly the ones above.

Now run **CPCBuild: Check Environment**. A panel in the Output view (the **CPCBuild** channel) lists
the compiler, Python 3, the library's `lib/` and `tools/` folders, the chosen emulator and
`mkdsk.py`, each as found or missing, with a hint for the missing ones.
<!-- CHECK: exact wording and layout of the Check Environment output; the spec says it reports found/missing for zxbc, Python 3, lib/, tools/, emulator, Arkos tools, mkdsk.py, Tiled, with a fix for each missing one. -->

If something says missing, fix it before you go on. If `zxbc` is missing, check the `poetry run zxbc
--version` command works in a terminal in the `zxbasic` folder first.

## Step 3: Create the project

Run **CPCBuild: New Project**. Studio asks three things, one after another:

1. **Choose a template.** Pick **Shared CPC + Spectrum** ("One game, platform layers per machine").
   That is the layout Lamplighter uses. The other three templates (Firmware, Bare metal, Plus
   cartridge) are one-machine programs.
2. **Project name.** Type `lamplighter`. This is also the folder name.
3. **Parent folder.** Pick a folder to put `lamplighter/` in. Studio uses the button label
   **Create project here**.

Studio writes the files and shows a message like:

```
Created /your/folder/lamplighter. Disc name: LAMPLIGH (run"LAMPLIGH).
```

The disc name is the name the program has on the disc image: upper-case letters and digits, at most
eight, made from your project name. Click **Open Folder** in that message (or use
**File > Open Folder...**).
<!-- CHECK: whether New Project is a quick-pick sequence (as the extension source shows) or the webview "template picker" the UX design describes; the source in vscode/cpcbuild-studio/src/ext/newProject.ts is quick-pick plus input box plus folder dialog. -->

You should see this in the Explorer:

```
lamplighter/
  .gitignore
  README.md
  cpcbuild.json
  assets/
    README.md
    cpc/pens.cpcpal
    zx/
  src/
    main.bas
    game.bas
    platform_cpc.bas
    platform_zx.bas
```

The status bar now shows `$(chip) cpc6128`: the **target** that Build and Run will use. Click it,
or run **CPCBuild: Select Target**, and choose `cpc464`. Lamplighter's main target is the CPC 464
(it has to fit in the 464's memory and run at 25 steps a second there), so we will use it all the
way through.

## Step 4: Build and run

Run **CPCBuild: Build and Run**.

The **CPCBuild** output channel shows the steps: the compiler runs, `mkdsk.py` packs the program
into a disc image, a report says how big the program is, and the emulator opens.

A new editor tab opens with a CPC screen in it. **Click on the screen** once: that gives the CPC your
keyboard (press `Ctrl+Shift+Esc` to give it back to VS Code), and the **Click for sound** button
starts the audio, because browsers only allow sound after a click.

You should see a CPC text screen with `HELLO FROM CPCBUILD` at the top and an `O` bouncing around.
Press `ESC` and the program ends.

> **If the tab does not open.** Check the setting `cpcbuild.run.emulator`: it should be `emu`. If
> it is `emu` but the Emulator extension is missing, Studio says so once with the choices
> **Install** and **Use external**. **CPCBuild: Select Emulator** lets you choose `emu`, `caprice32`,
> `cpcec`, `rvm` or `custom`.

Look at what the build wrote. A `build/` folder appeared (it is in `.gitignore`) with the compiled
program, a `.map` file listing every address in it, and the `.dsk` disc image. You will use the `.map`
in chapter 9.
<!-- CHECK: exact file names in build/ (spec says build/NAME.map, NAME.bin, a .dsk; the output folder is the cpcbuild.build.outputDir setting, default "build"). -->

## Step 5: Read the project file

Open `cpcbuild.json`. Studio treats any folder with this file as a project (Studio does nothing to
`.bas` files in folders without one, so it will not disturb a NextBuild project). The template wrote:

```json
{
  "version": 1,
  "name": "lamplighter",
  "targets": [
    { "id": "cpc6128", "arch": "cpc", "main": "src/main.bas", "model": "6128",
      "defines": ["CPC6128"], "package": "dsk", "disc": "LAMPLIGH" },
    { "id": "cpc464", "arch": "cpc", "main": "src/main.bas", "model": "464",
      "defines": ["CPC464"], "package": "dsk", "disc": "LAMPLIGH" },
    { "id": "zx128", "arch": "zx48k", "main": "src/main.bas",
      "defines": ["ZX128"], "org": 31744, "heap": 256, "package": "tap" },
    { "id": "zx48", "arch": "zx48k", "main": "src/main.bas",
      "defines": ["ZX48"], "org": 32768, "heap": 256, "package": "tap" }
  ],
  "assets": ["assets/**/*.png"]
}
```

(Studio may format it slightly differently.) A **target** is one build: which machine
(`arch`), which entry file (`main`), which `-D` switches go to the compiler (`defines`), and how to
package it (`package`: a disc image `dsk`, a Spectrum tape `tap`). The `CPC464` and `CPC6128`
defines are how the game's code tells the two models apart.

Change the `assets` line now. It lists the files Studio treats as asset sources, and from chapter 2
those are Studio's own documents and import recipes, not PNGs:

```json
  "assets": ["assets/**/*.cpcimp", "assets/**/*.cpcspr", "assets/**/*.cpctil"]
```
<!-- CHECK: the assets globs the shared template writes ("assets/**/*.png") versus the other three templates ("assets/**/*.cpcimp" etc.); confirm which one "Regenerate Assets" and "regenerate before build" need for .cpcimp recipes to be picked up. -->

## Step 6: See how the code is organised

Open the four files in `src/`. They are small. Together they are a miniature of the whole game.

`src/main.bas` only chooses which platform layer to use, then pulls in the game:

```basic
#ifdef __CPC__
#include "platform_cpc.bas"
#else
#include "platform_zx.bas"
#endif
#include "game.bas"
```

The compiler defines `__CPC__` itself when you build with `--arch cpc`. (Boriel's preprocessor takes
`#ifdef` and `#ifndef`, but not `#if defined(...)`; Lamplighter only ever uses `#ifdef`.)

`src/platform_cpc.bas` is the only file that knows this is a CPC:

```basic
#include <cpc.bas>
#include <cpcbuild.bas>

SUB PlatInit()
  Mode 1
  ScreenInit()
  CLS
END SUB

SUB PlatWait()
  WaitRetrace(1)
END SUB

FUNCTION PlatQuit() AS UBYTE
  ScanKeys()
  RETURN KeyDown(KEY_ESC)
END FUNCTION
```

and `src/game.bas` is the game, written only in terms of `PlatInit`, `PlatWait` and `PlatQuit`:

```basic
DIM x, y, dx, dy AS UBYTE

PlatInit()
PRINT AT 0, 0; "HELLO FROM CPCBUILD"
x = 5
y = 5
dx = 1
dy = 1
DO
  PlatWait()
  PRINT AT y, x; " "
  IF x >= 28 THEN dx = 255
  IF x <= 1 THEN dx = 1
  IF y >= 20 THEN dy = 255
  IF y <= 2 THEN dy = 1
  x = x + dx
  y = y + dy
  PRINT AT y, x; "O"
LOOP UNTIL PlatQuit()
END
```

This split is the most important idea in the tutorial, so say it once more: **`game.bas` never draws,
reads a key or makes a sound by itself. It asks the platform layer.** That is how one game becomes a
CPC 464 game, a Spectrum game, and a Plus game (chapters 10 and 11) without rewriting the rules.
In the finished Lamplighter the platform layer has these calls, and `game.bas` uses nothing else
(`game.bas:1-18`):

| Call | What it does |
|---|---|
| `PlatRoom(addr)` | draw the room whose 20 x 23 tiles are at `addr` |
| `PlatTile(cx, cy, tile)` | one cell changed |
| `PlatSprite(slot, frame, x, y)` | slot 0 is the player, 1 to 4 the enemies |
| `PlatHud(lit, total, lives, room)` | the two text rows at the bottom |
| `PlatSfx(n)` | a sound effect |

## Step 7: Change something

Edit `src/game.bas`: change the text in `PRINT AT 0, 0; "HELLO FROM CPCBUILD"` to
`"HELLO FROM <your name>"`. Save, then run **CPCBuild: Build and Run** again.

The emulator tab is reused: the new disc is loaded into the open session instead of opening a
second tab.

## Step 8: Break it on purpose

Errors are how you learn the compiler's voice. Change `PlatQuit()` in `game.bas` to `PlatQuitt()`
(an extra `t`), save, and run **CPCBuild: Build**.

The build stops and the **Problems** panel (`Ctrl+Shift+M`) shows an entry like:

```
game.bas:22: error: 'PlatQuitt' is neither an array nor a function.
```

Click it and VS Code jumps to the line. Studio does this with a *problem matcher* named `$zxbc`,
which reads the compiler's `file:line: error: message` lines. Warnings show up the same way, with
a code such as `[W170]`. Some you will meet in this tutorial:

| Warning | Meaning |
|---|---|
| `W170` | a function that is never called has been dropped (harmless) |
| `W150` | a parameter or variable that is never used |

Fix the typo, and build again.

## Step 9: Build the Spectrum tape

Run **CPCBuild: Select Target**, pick `zx48`, and run **CPCBuild: Build**. You get a `.tap` file in
`build/`. Spectrum targets are *build-only* here: Studio does not ship a Spectrum emulator, so you
load the tape in your own (or on a real Spectrum with `LOAD ""`).
<!-- CHECK: that Build (not Build and Run) is the right command for tap targets and what Build and Run does for them. -->

Both machines run the same `game.bas`: the Spectrum draws with `PRINT AT` through
`platform_zx.bas` and quits on `SPACE`. In chapter 10 we come back and give the Spectrum its own
tiles and sprites. Until then, **we build only the CPC 464 target**, because from chapter 2 on
`platform_cpc.bas` grows calls that `platform_zx.bas` does not have yet. Select `cpc464` again.

---

## Boriel BASIC for Locomotive BASIC programmers

Boriel BASIC reads like Sinclair BASIC extended with structure, and compiles to machine code. The
things you will trip over first:

| In Locomotive BASIC | In Boriel BASIC |
|---|---|
| Line numbers | None. Labels and `SUB`/`FUNCTION` instead. |
| Variables are real numbers unless you suffix them | Declare with `DIM x AS UBYTE`; undeclared ones default to float (a compiler warning, and very slow). Lamplighter uses `UBYTE`, `UINTEGER`, `BYTE` and `INTEGER` only. |
| `AND`, `OR` work on bits | `AND`, `OR` are logical; use **`BAND`**, **`BOR`**, **`BXOR`** for bits. |
| `FOR i = 0 TO 255` | A `UBYTE` counter that reaches 255 never ends. |
| `GOSUB` | `SUB name(args)` ... `END SUB` and `FUNCTION name(args) AS type` ... `RETURN value`. |
| `INKEY$`, `JOY()` | `ScanKeys()` then `KeyDown(key)`. |

The last three rows come from the library's own notes (`docs/library.md`, **Performance tips**, section
"Other things that cost time or memory"). Another trap the finished game's author found:
`FOR i = 0 TO n - 1` with a `UBYTE n = 0` loops 256 times, because `n - 1` wraps to 255
(`DESIGN.md`, "As built").

Two library ideas to keep in mind from the start:

- The CPC library has its **own coordinates**. `x` is in *bytes* (not pixels), `y` in pixel lines, from
  the top left. Tiles use cells. See **Coordinates** in `docs/library.md`.
- After every `Mode` call, call **`ScreenInit()`**. `Mode` does not tell the library about the new
  screen; `ScreenInit()` does. See **Using the library**.

## Try this

1. In `platform_cpc.bas` change `Mode 1` to `Mode 0` and rebuild. What changes? (Mode 0 has 20
   text columns, so the `O` runs off the edge: the game's `x >= 28` test is for 40 columns.)
2. Select the `cpc6128` target and run it. Is anything different on screen?
3. Add a `PlatBeep` call: a `SUB PlatBeep()` in `platform_cpc.bas` that does `BEEP 1, 0`, and call it from `game.bas` when the `O` bounces. Does the Spectrum build still compile? (It will not: `PlatBeep` is missing in `platform_zx.bas`. This is exactly the discipline chapter 10 needs.)

## What you have now

A project that builds for four targets, runs in an emulator tab, and has the shape of the finished
game. Next: [Chapter 2, Palette and tiles](02-palette-and-tiles.md).
