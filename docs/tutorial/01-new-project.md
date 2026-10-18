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

The two extensions are separate on purpose. Studio does the editing, building and debugging.
The Emulator extension is the CPC in a tab. They talk only through VS Code commands, and Studio
works without the emulator: it can start Caprice32, CPCEC or Retro Virtual Machine as an external
program instead (the `cpcbuild.run.emulator` setting, step 4).

Two things to know about where Studio shows up:

- Studio wakes up in a folder that contains a `cpcbuild.json` (step 5). Only then do its Explorer
  right-click entries (**Import Image**, **Convert Tiled Map to BASIC**, **Run in Emulator**...) and its
  **CPCBuild** icon (a chip) in the Activity Bar appear. In any other folder Studio leaves your
  `.bas` files alone.
- **Restricted Mode.** If you clone a project (or open a folder you have not opened before), VS Code asks
  whether you trust its authors. Until you answer **Yes, I trust the authors**, Studio is limited: the
  editors open, but **Build**, **Run**, asset generation and the tool checks refuse with a message that
  points at **Manage Workspace Trust**. A project you create in step 3 and open yourself is yours, so
  trust it. (The Emulator extension runs in Restricted Mode: it starts no program.)

## Step 2: Tell Studio where the compiler is

Studio runs the Boriel compiler for you, and the CPC backend lives in the `zxbasic` fork. Open
**Settings** (`Ctrl+,`) and search for `cpcbuild`, or run **CPCBuild: Open Settings**. Set:

| Setting | Value |
|---|---|
| `cpcbuild.zxbc.command` | `["poetry", "run", "zxbc"]` |
| `cpcbuild.zxbc.cwd` | the path of your `zxbasic` checkout (branch `cpc-arch`) |

The first two are the ones Studio's own documentation gives for the Poetry setup. You do **not** need a
cpcbuild checkout for the library: Studio carries a copy of `lib/` and the Python converters inside the
extension and uses it when nothing else is found (chapter 11's Plus library is in it too). The setting
`cpcbuild.library.path` points Studio at a different copy; leave it empty for this tutorial.

The `cpcbuild.zxbc.cwd` folder does a second job: it is where Studio looks for `mkdsk.py`, the tool that
packages a disc image. `mkdsk.py` belongs to the compiler (AGPL licence), so it is not bundled in the
extension; without the `zxbasic` checkout there is no `.dsk`.

> **Tip.** If you prefer editing `settings.json`: the keys are exactly the ones above.

Now run **CPCBuild: Check Environment**. It writes a list to the **CPCBuild** channel of the Output view and
shows a message when something required is missing. Each line is `[ok]`, `[optional]` or `[MISSING]`, then
the item and where it was found, with a `fix:` line under every missing one. A good result looks like this
(paths and versions will differ):

```
CPCBuild environment check
  [ok] zxbc (Boriel BASIC compiler, cpc arch): poetry run zxbc: zxbc 1.x ...
  [ok] Python 3: python3: Python 3.x.y
  [ok] cpcbuild library (lib/): /.../bundled/lib
  [ok] cpcbuild tools/ (mkcpr.py): /.../bundled/tools/mkcpr.py
  [ok] mkdsk.py (zxbasic tools/cpc/): /.../zxbasic/tools/cpc/mkdsk.py
  [ok] Emulator: cpcbuild-emu extension: cpcbuild.emu.version answers
  [optional] Arkos command-line tools: not found
        fix: Run `sh tools/arkos/fetch.sh` ...
  [optional] Tiled map editor: not found
        fix: Install Tiled (mapeditor.org) for "Open in Tiled".
```

(The labels are the ones in Studio's `doctor.ts`; the exact paths and version text depend on your machine.
The Arkos tools and Tiled are optional: chapters 3 and 8 say when you would want them.)

If something says `MISSING`, fix it before you go on. If `zxbc` is missing, check that `poetry run zxbc
--version` works in a terminal in the `zxbasic` folder first. In Restricted Mode the compiler and Python
lines say `not run` instead of being checked.

## Step 3: Create the project

Run **CPCBuild: New Project**. Studio asks three things, one after another:

1. **Choose a template.** A quick-pick list at the top of the window. Pick **Shared CPC + Spectrum**
   ("One game, platform layers per machine; .dsk and .tap"). That is the layout Lamplighter uses.
   The other three templates (**Firmware (CPC 464/6128)**, **Bare metal (no firmware)**, **Plus
   cartridge**) are one-machine programs.
2. **Project name.** An input box that starts with `mygame`. Type `lamplighter`. This is also the folder name.
3. **Parent folder.** A folder dialog titled "Parent folder for the new project". Pick a folder to put
   `lamplighter/` in. The button says **Create project here**. If `lamplighter/` already exists and is not
   empty, Studio asks before it overwrites files with the same names.

Studio writes the files and shows a message like:

```
Created /your/folder/lamplighter. Disc name: LAMPLIGH (run"LAMPLIGH).
```

The disc name is the name the program has on the disc image: upper-case letters and digits, at most
eight, made from your project name. Click **Open Folder** in that message (or use
**File > Open Folder...**).

You should see this in the Explorer (`assets/zx/` holds only a hidden `.gitkeep`):

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

The template keeps its code in `src/`. The finished game does not, and step 5 moves your files to match it.

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

Look at what the build wrote. A `build/` folder appeared (it is in `.gitignore`; the setting
`cpcbuild.build.outputDir` changes the name). Its files are named after the **target id**, not the project:
`cpc464.bin` (the compiled program), `cpc464.map` (every address in it) and `cpc464.dsk` (the disc image,
which holds the program as `LAMPLIGH.BIN`). You will use the `.map` in chapter 9.

The last lines of the channel are the build report and `Started cpc464.dsk in emu`. For the template's
little program (2,374 bytes when this was checked) the report is:

```
Build report for cpc464:
  2374 bytes, &0040-&0986
    headroom below &4000: 13946 bytes  [back screen / banks (double buffering)]
    headroom below &8B60: 33242 bytes  [firmware heap start]
Built /your/folder/lamplighter/build/cpc464.dsk
```

Chapter 9 reads the report line by line. Run **CPCBuild: Show Build Report** to print the last one again.

## Step 5: Read the project file, and flatten the layout

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
package it (`package`: a disc image `dsk`, a Spectrum tape `tap`; a Plus cartridge is `cpr`, chapter 11).
The `CPC464` and `CPC6128` defines are how the game's code tells the two models apart.

The finished game's `games/lamplighter/cpcbuild.json` has the same shape with five targets, named
`lamp464`, `lamp6128`, `lampplus` (the cartridge), `zx48` and `zx128`. Your project grows the same
targets as the chapters go on, under the template's ids.

Now make two changes so your project matches the finished game.

**1. Flatten the layout.** The template keeps the code in `src/`; the finished game keeps its `.bas`
files at the project root and its generated data in `assets/`. We follow the finished game, so that
`#include "assets/tiles.bas"` means the same thing in your code and in `games/lamplighter/`. In the Explorer:

- Drag `main.bas`, `game.bas`, `platform_cpc.bas` and `platform_zx.bas` out of `src/` onto the
  `lamplighter` folder, then delete the empty `src/`.
- Delete `assets/README.md` and `assets/cpc/` (the template's placeholder palette; chapter 2 brings the
  real one). Keep `assets/zx/`.
- In `cpcbuild.json` change every `"main": "src/main.bas"` to `"main": "main.bas"`.

From here on, every path in this tutorial is relative to the `lamplighter/` folder.

**2. Change the `assets` line.** It lists the files Studio treats as asset sources. **CPCBuild: Regenerate
Assets**, and the automatic "regenerate stale assets before a build", look only at the globs that end in
`.cpcimp`: they find your import recipes (chapter 2) and rebuild the ones whose output is older than the
image, the palette file or the recipe. The template's `assets/**/*.png` matches no recipe, so nothing would
ever be regenerated. Use the finished game's line:

```json
  "assets": ["assets/**/*.cpcimp", "assets/**/*.cpcpal"]
```

Run **CPCBuild: Build** once more to check that the moved project still builds.

## Step 6: See how the code is organised

Open the four `.bas` files. They are small. Together they are a miniature of the whole game.

`main.bas` only chooses which platform layer to use, then pulls in the game:

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

`platform_cpc.bas` is the only file that knows this is a CPC:

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

and `game.bas` is the game, written only in terms of `PlatInit`, `PlatWait` and `PlatQuit`:

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
In the finished Lamplighter, `game.bas` makes just these five calls into the platform layer (its header
comment lists them, `game.bas:1-18`); `main.bas` adds the calls of the main loop (`PlatInput`,
`PlatFrameEnd`, `PlatText`, `PlatMusic` and a few more, chapters 3 to 8):

| Call | What it does |
|---|---|
| `PlatRoom(addr)` | draw the room whose 20 x 23 tiles are at `addr` |
| `PlatTile(cx, cy, tile)` | one cell changed |
| `PlatSprite(slot, frame, x, y)` | slot 0 is the player, 1 to 4 the enemies |
| `PlatHud(lit, total, lives, room)` | the two text rows at the bottom |
| `PlatSfx(n)` | a sound effect |

## Step 7: Change something

Edit `game.bas`: change the text in `PRINT AT 0, 0; "HELLO FROM CPCBUILD"` to
`"HELLO FROM <your name>"`. Save, then run **CPCBuild: Build and Run** again.

The emulator tab is reused: the new disc is loaded into the open session instead of opening a
second tab.

## Step 8: Break it on purpose

Errors are how you learn the compiler's voice. Change `PlatQuit()` in `game.bas` to `PlatQuitt()`
(an extra `t`), save, and run **CPCBuild: Build**.

The build stops and the **Problems** panel (`Ctrl+Shift+M`) shows an entry like this, with `zxbc` as its
source:

```
'PlatQuitt' is neither an array nor a function.   zxbc  [Ln 22, Col 1]
```

The **CPCBuild** channel has the compiler's own line:

```
/your/folder/lamplighter/game.bas:22: error: 'PlatQuitt' is neither an array nor a function.
```

Click the Problems entry and VS Code jumps to the line. Studio does this with a *problem matcher* named
`$zxbc`, which reads the compiler's `file:line: error: message` lines. Warnings show up the same way, with
the code after the source, like `zxbc(W100)`. Some you will meet in this tutorial:

| Warning | Meaning |
|---|---|
| `W170` | a function that is never called has been dropped (harmless) |
| `W150` | a parameter or variable that is never used |
| `W100` | a variable with no `DIM`: it got a default type (`ubyte`) |

Fix the typo, and build again.

## Step 9: Build the Spectrum tape

Run **CPCBuild: Select Target**, pick `zx48`, and run **CPCBuild: Build**. You get `build/zx48.tap`, and
the channel prints a one-line report with the tape's size and origin (`zx48.tap: ... bytes, origin 32768`).
Spectrum targets are *build-only*: Studio does not ship a Spectrum emulator, so you load the tape in your
own (or on a real Spectrum with `LOAD ""`). If you run **Build and Run** on a `tap` target, the build
succeeds and then Studio says "Target zx48 has no disc or cartridge to run (Spectrum and raw .bin targets
are build-only)": that is the message, not a failure of your code.

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
game.

One thing to know before you go on: Studio does not do *everything* the finished game's scripts do. The
art drawing, the splitting of the map into rooms, the size-limit checks and the Plus loader disc stay
outside it. Each chapter says so where it matters, and the [README](README.md#what-studio-does-not-do-for-this-game)
lists them in one place. Next: [Chapter 2, Palette and tiles](02-palette-and-tiles.md).
