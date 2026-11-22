# Chapter 1: A new project

**Goal.** Create a CPCBuild project from the Studio template, build it, run it in an emulator tab
inside VS Code, break it on purpose to see how errors show up, and split the program into the
three files Lamplighter uses. By the end you know the edit, build, run loop that every later chapter uses.

**What you'll learn**

- How to install CPC Game Studio and check that it is ready (the compiler is inside it).
- What a CPCBuild project is: `cpcbuild.json`, targets, and the `build/` folder.
- Why Lamplighter is split into `main.bas`, `game.bas` and `platform_cpc.bas`.
- A few things that are different between Locomotive BASIC and CPC BASIC.

**Time:** about 20 minutes.

---

## Step 1: Install the two extensions

Go to the [Releases page](https://github.com/carcharo/cpcbuild/releases) of `carcharo/cpcbuild` and download
`cpcbuild-studio-0.2.0.vsix` and `cpcbuild-emu-0.2.0.vsix`. Then, in VS Code,
open the Command Palette and run **Extensions: Install from VSIX...**, once for each file. (Or open the
Extensions view, choose its **...** menu and then **Install from VSIX...**.) Reload the window if VS Code asks.

You run **CPC Game Studio** commands from the Command Palette: `Ctrl+Shift+P` on Windows and Linux,
`Cmd+Shift+P` on macOS. Studio does not bind keys to its commands, so this is the only shortcut you need.
Where the tutorial gives another VS Code shortcut, such as `Ctrl+S`, macOS uses `Cmd` in place of `Ctrl`.

(If you downloaded the SDK instead, `cpcbuild-sdk-0.2.0.zip`, the two `.vsix` files are inside it, with the
library, the docs and `games/lamplighter/`. Install them the same way. The SDK is one archive for all three systems.)

Notes for your system (skip the ones that are not yours):

- **Windows.** Extract the SDK zip with **Extract All** and keep the folder on a local drive, with a short path
  such as `C:\cpcbuild-sdk`. In a Windows virtual machine (Parallels and the like), a folder shared from the host
  shows up as a `\\Mac\...` network path, and VS Code refuses it ("UNC host 'mac' access is not allowed"). Keep
  the `.vsix` files and your projects on a local drive such as `C:\`.
- **macOS.** Nothing to approve: there are no programs to install, only the two extensions. (Keyboard: `Cmd` where the
  tutorial says `Ctrl`, except for giving the keyboard back from the emulator tab, step 4.)
- **Linux.** VS Code's website offers the x64 `.deb` by default. On an ARM machine (a Raspberry Pi, an ARM
  virtual machine) download the **Arm64** `.deb` and install it in a terminal with
  `sudo apt install ./code_*_arm64.deb`; Ubuntu's App Center can hang on `.deb` files.

The two extensions are separate on purpose. Studio does the editing, building and debugging.
The Emulator extension is the CPC in a tab. They talk only through VS Code commands, and Studio
works without the emulator: it can start Caprice32, CPCEC or Retro Virtual Machine as an external
program instead (the `cpcbuild.run.emulator` setting, step 4).

Two things to know about where Studio shows up:

- Studio wakes up in a folder that contains a `cpcbuild.json` (step 3). Only then do its Explorer
  right-click entries (**Import Image**, **Convert Tiled Map to BASIC**...) and its
  **CPC Game Studio** icon (a chip) in the Activity Bar appear. In any other folder Studio leaves your
  `.bas` files alone.
- **Restricted Mode.** If you clone a project (or open a folder you have not opened before), VS Code asks
  whether you trust its authors. Until you answer **Yes, I trust the authors**, Studio is limited: the
  editors open, but **Build**, **Run**, asset generation and the tool checks refuse with a message that
  points at **Manage Workspace Trust**. A project you create in step 3 and open yourself is yours, so
  trust it: when VS Code asks whether to trust the new folder, choose **Trust**, because Studio needs it to
  build. (The Emulator extension runs in Restricted Mode: it starts no program.)

## Step 2: Check that Studio is ready

There is nothing else to install. The compiler, `cpcbas`, runs inside the Studio extension, and so do the library
(`lib/`), the image and map converters and the disc and cartridge packers. You need no Python and no compiler download. (Chapter 8 offers one
optional download, the Arkos tools for converting your own music.)

Run **CPC Game Studio: Check Environment** from the Command Palette. It writes a list to the **CPC Game Studio** channel of the
Output view and shows a message when something required is missing. Each line is `[ok]`, `[optional]` or `[MISSING]`, then
the item and where it was found, with a `fix:` line under every one that is not ok. The result looks like this (paths and version text will differ):

```
CPC Game Studio environment check
  [ok] cpcbas (CPC BASIC compiler): <version>, built in (it runs inside the extension)
  [ok] BASIC library (lib/): /.../lib
  [optional] Python 3: ...
        note: Only needed with the python image engine; the built-in engine needs nothing.
  [ok] Image and cartridge tools: built in
  [ok] Emulator: CPC Game Studio Emulator: installed, <version>
  [optional] Arkos command-line tools: not found
        fix: Run "CPC Game Studio: Download Tools". Or set "cpcbuild.arkos.toolsPath" to a folder with the Arkos Tracker command-line tools. Only needed to convert music and sound effects.
  [optional] Tiled map editor: not found
        fix: Install Tiled (mapeditor.org) for "Open in Tiled".
```

(The labels are the ones in Studio's `doctor.ts`. The Python line is `[ok]` if Python 3 is installed; it is optional because nothing
in Studio needs it. The Arkos line says `[optional]` and `not found` until you download those tools in chapter 8. Tiled is optional: chapter 3 says when you
would want it.)

If a required line says `MISSING`, read its `fix:` line: for the library it says to install CPC Game Studio again. In Restricted Mode the
Python line says `not run` instead of being checked.

## Step 3: Create the project

Run **CPC Game Studio: New Project**. Studio asks three things, one after another:

1. **Choose a template.** A quick-pick list at the top of the window. Pick **Firmware (CPC 464/6128)** ("Mode 1
   program using the firmware; disc image"). The other two templates (**Bare metal (no firmware)** and **Plus
   cartridge**) are for chapter 10 and for your own projects.
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

You should see this in the Explorer:

```
lamplighter/
  .gitignore
  README.md
  cpcbuild.json
  assets/
    pens.cpcpal
    ball.cpcspr
    ball.bas
  src/
    main.bas
```

The template is a small program in `src/main.bas`: a ball that bounces round the screen, drawn from the sprite
document `ball.cpcspr` with the four pens of `pens.cpcpal`. Step 6 replaces it with Lamplighter's own layout.

The status bar now shows `$(chip) cpc6128`, as the chip icon and the **target** that Build and Run will use. Click it,
or run **CPC Game Studio: Select Target**, and choose `cpc464`. Lamplighter's main target is the CPC 464
(it has to fit in the 464's memory and run at 25 steps a second there), so we will use it all the
way through.

## Step 4: Build and run

Run **CPC Game Studio: Build and Run**.

The **CPC Game Studio** output channel shows the steps: the compiler runs, a report says how big the program is, the disc image is
written, and the emulator opens.

A new editor tab opens with a CPC screen in it. **Click on the screen** once: that gives the CPC your
keyboard (press `Ctrl+Shift+Esc` to give it back to VS Code, `Ctrl+Shift+F6` on Windows, where Windows keeps
`Ctrl+Shift+Esc` for Task Manager; on a Mac it is the `Control` key, not `Cmd`), and the **Click for sound** button
starts the audio, because browsers only allow sound after a click.

You should see `HELLO FROM CPCBUILD - ESC QUITS` in white at the top of the screen and a small red ball with a green
rim bouncing round it. Press `ESC` and the program ends.

> **If the tab does not open.** Check the setting `cpcbuild.run.emulator`: it should be `emu`. If
> it is `emu` but the Emulator extension is missing, Studio says so once with the choices
> **Install** and **Use external**. **CPC Game Studio: Select Emulator** lets you choose `emu`, `caprice32`,
> `cpcec`, `rvm` or `custom`.

Look at what the build wrote. A `build/` folder appeared (it is in `.gitignore`; the setting
`cpcbuild.build.outputDir` changes the name). Its files are named after the **target id**, not the project:
`cpc464.bin` (the compiled program), `cpc464.map` (every address in it) and `cpc464.dsk` (the disc image,
which holds the program as `LAMPLIGH.BIN`). You will use the `.map` in chapter 9.

The last lines of the channel are the build report and `Started cpc464.dsk in emu`. For the template's
little program (2,394 bytes when this was checked) the report is:

```
Build report for cpc464:
  2394 bytes, &0040-&0999
    headroom below &4000: 13926 bytes  [back screen (double buffering)]
    headroom below &8B60: 33222 bytes  [firmware heap start]
Built /your/folder/lamplighter/build/cpc464.dsk
```

Chapter 9 reads the report line by line. Run **CPC Game Studio: Show Build Report** to print the last one again.

## Step 5: Read the project file

Open `cpcbuild.json`. Studio treats any folder with this file as a project (Studio does nothing to
`.bas` files in folders without one, so it will not disturb your other BASIC projects). The template wrote this (laid out
more compactly here than in the file, which puts one value on each line):

```json
{
  "version": 1,
  "name": "lamplighter",
  "targets": [
    { "id": "cpc6128", "arch": "cpc", "main": "src/main.bas", "model": "6128",
      "defines": ["CPC6128"], "package": "dsk", "disc": "LAMPLIGH" },
    { "id": "cpc464", "arch": "cpc", "main": "src/main.bas", "model": "464",
      "defines": ["CPC464"], "package": "dsk", "disc": "LAMPLIGH" }
  ],
  "assets": ["assets/**/*.cpcimp", "assets/**/*.cpcspr", "assets/**/*.cpcpal",
             "assets/**/*.cpcsfx", "assets/**/*.cpcsong"]
}
```

(Studio writes it with one item to a line.) A **target** is one build: which machine
(`arch`, always `cpc`), which entry file (`main`), which `-D` switches go to the compiler (`defines`), and how to
package it (`package`: a disc image `dsk`, or a Plus cartridge `cpr`, chapter 10). The `CPC464` and `CPC6128` defines are how the
game's code tells the two models apart.

The finished game's `games/lamplighter/cpcbuild.json` has the same shape with three targets, named
`lamp464`, `lamp6128` and `lampplus` (the cartridge). Your project grows the same
targets as the chapters go on, under the template's ids.

The `assets` line lists the files Studio treats as asset sources. **CPC Game Studio: Regenerate
Assets**, and the automatic "regenerate stale assets before a build", look at the globs that end in
`.cpcimp`: they find your import recipes (chapter 2) and rebuild the ones whose output is older than the
image, the palette file or the recipe. The template's line is already right, and the finished game's is the shorter
`["assets/**/*.cpcimp", "assets/**/*.cpcpal"]`.

## Step 6: Split the program into three files

The template keeps its code in `src/`. The finished game keeps its `.bas` files at the project root and its
generated data in `assets/`, so that `#include "assets/tiles.bas"` means the same thing in your code and in
`games/lamplighter/`. Make your project match it. In the Explorer:

- Delete the `src/` folder, and `assets/ball.cpcspr`, `assets/ball.bas` and `assets/pens.cpcpal` (the template's
  placeholder program and palette; chapter 2 brings the real palette).
- In `cpcbuild.json` change every `"main": "src/main.bas"` to `"main": "main.bas"`.
- Create three files in the project folder, with the contents below: `main.bas`, `game.bas` and `platform_cpc.bas`.

From here on, every path in this tutorial is relative to the `lamplighter/` folder.

`main.bas` only pulls in the platform layer, then the game:

```basic
#include "platform_cpc.bas"
#include "game.bas"
```

(In chapter 10 the first line becomes a choice between two layers, with `#ifdef` and `#else`: the preprocessor takes `#ifdef` and
`#ifndef`, which is all Lamplighter ever uses.)

`platform_cpc.bas` is the only file that touches the hardware: the screen, the keys and, later, the sound (chapter 10 adds a
second layer beside it, for the CPC Plus):

```basic
#include <cpc.bas>
#include <cpcbuild.bas>

SUB PlatInit()
  MODE 1
  ScreenInit()
  CLS
END SUB

SUB PlatWait()
  FRAME
END SUB

FUNCTION PlatQuit() AS UBYTE
  ScanKeys()
  RETURN KeyDown(KEY_ESC)
END FUNCTION
```

and `game.bas` is the game, written only in terms of `PlatInit`, `PlatWait` and `PlatQuit`:

```basic
DIM x, y, ox, oy, dx, dy AS UBYTE

PlatInit()
PRINT AT 0, 0; "HELLO FROM CPCBUILD"
x = 5
y = 5
dx = 1
dy = 1
DO
  PlatWait()
  ox = x
  oy = y
  IF x >= 28 THEN dx = 255
  IF x <= 1 THEN dx = 1
  IF y >= 20 THEN dy = 255
  IF y <= 2 THEN dy = 1
  x = x + dx
  y = y + dy
  PRINT AT y, x; "O"
  PRINT AT oy, ox; " "
LOOP UNTIL PlatQuit()
END
```

Select the `cpc464` target and run **CPC Game Studio: Build and Run** again. You should see `HELLO FROM CPCBUILD` at the top
and an `O` bouncing around, until you press `ESC`. (`dx = 255` is "minus one" in a `UBYTE`: adding it wraps round.)

The loop prints the new `O` first and only then blanks the old one (`ox`, `oy`). The other way round, the `O` would blink out
near the top of the screen: printing goes through the firmware and takes a few milliseconds a character, and the screen is
drawn line by line from the top, so the top rows are drawn before the new `O` arrives and show neither the old one nor the new.
(Near the top you may see the old `O` trail the new one for a frame: better than a gap.) Chapter 4 deals with this timing
properly, for sprites: draw right after the screen's flyback.

This split is the most important idea in the tutorial, so say it once more: **`game.bas` never draws,
reads a key or makes a sound by itself. It asks the platform layer.** That is how one game becomes a
CPC 464 game, a 6128 game and a Plus game (chapter 10) without rewriting the rules.
In the finished Lamplighter, `game.bas` makes just these five calls into the platform layer (its header
comment lists them); `main.bas` adds the calls of the main loop (`PlatInput`,
`PlatFrameEnd`, `PlatText`, `PlatMusic` and a few more, chapters 3 to 8):

| Call | What it does |
|---|---|
| `PlatRoom(addr)` | draw the room whose 20 x 23 tiles are at `addr` |
| `PlatTile(cx, cy, tile)` | one cell changed |
| `PlatSprite(slot, frame, x, y)` | slot 0 is the player, 1 to 4 the enemies |
| `PlatHud(lit, total, lives, room)` | the two text rows at the bottom |
| `PlatSfx(n)` | a sound effect |

The finished `game.bas` also writes a few speed-critical routines in Z80 assembly (inside `ASM ... END ASM`).
The tutorial has you write those routines in plain BASIC (chapters 5 to 7), so the whole game works with no
assembly. Chapter 9 measures that game and then brings the assembly in, one routine at a time, each with the figure that justifies it.

## Step 7: Change something

Edit `game.bas`: change the text in `PRINT AT 0, 0; "HELLO FROM CPCBUILD"` to
`"HELLO FROM <your name>"`. Save, then run **CPC Game Studio: Build and Run** again.

The emulator tab is reused: the new disc is loaded into the open session instead of opening a
second tab.

## Step 8: Break it on purpose

Errors are how you learn the compiler's voice. Change `PlatQuit()` in `game.bas` to `PlatQuitt()`
(an extra `t`). While you type, and after a short pause, Studio runs the compiler's checker on your program and
underlines the error in the editor. Save, and run **CPC Game Studio: Build**.

The build stops and the **Problems** panel (`Ctrl+Shift+M`, `Cmd+Shift+M` on macOS) shows an entry like this, with `cpcbas` as its
source:

```
'PlatQuitt' is not an array or a FUNCTION
Hint: DIM the array first: DIM PlatQuitt(10).   cpcbas(E204)  [Ln 19, Col 12]
```

The **CPC Game Studio** channel has the compiler's own lines, `file:line:column: severity code: message`, with the hint under it:

```
game.bas:19:12: error E204: 'PlatQuitt' is not an array or a FUNCTION
  hint: DIM the array first: DIM PlatQuitt(10).
```

(The hint is written for the most common cause of this error, a misspelt array; here it is a misspelt SUB or FUNCTION.)
Click the Problems entry and VS Code jumps to the line. Warnings show up the same way, with a code starting with `W`. You will see one
now: `W306`, "'PlatQuit' is never called; it is not compiled", because with the typo nothing calls `PlatQuit`. Some you will meet in this tutorial:

| Warning | Meaning |
|---|---|
| `W306` | a SUB or FUNCTION that nothing calls is left out of the program (harmless) |
| `W301` | a variable that is read but never assigned |
| `W300` | a variable used without a `DIM` (it is an `INTEGER`); the compiler only says so with the option `-Wimplicit`, which you can put in the setting `cpcbuild.compiler.args` |

Fix the typo, and build again.

---

## CPC BASIC for Locomotive BASIC programmers

CPC BASIC is Locomotive BASIC 1.1 as you know it (`MODE`, `PRINT AT`, `INK`, `PEN`, `FOR`, `DATA`...) with a few
additions that make compiled games fast: typed `SUB` and `FUNCTION`, typed variables and arrays, inline Z80, `#include` and
`#ifdef`. The things you will trip over first:

| In Locomotive BASIC | In CPC BASIC |
|---|---|
| Line numbers | Optional, and Lamplighter has none. Structure comes from `SUB`, `FUNCTION`, `DO ... LOOP` and `#include`. |
| Every number is a real unless you suffix it | An untyped variable is an `INTEGER`: `x = 3.5` stores 3, and `7 / 2` is 3. Declare what you need: `DIM x AS UBYTE`. Lamplighter uses `UBYTE`, `UINTEGER`, `BYTE` and `INTEGER` only. |
| `AND`, `OR`, `NOT` work on bits; true is -1 | The same: `6 AND 3` is 2, `NOT 5` is -6, and `PRINT 5 > 3` prints -1. |
| Numbers print with a space in front (`PRINT 5` gives ` 5 `) | The same, so the benchmark lines in chapter 9 have spaces round the numbers. |
| `INK` and `PEN` | The same: `INK n, c` gives pen `n` the colour `c`, and `PEN n` chooses the text pen. |
| `FOR i = 0 TO n - 1` | Watch the type of `n`: with a `UBYTE n = 0` that loop runs 256 times, because `n - 1` wraps to 255. |
| `GOSUB` | Still there, but Lamplighter uses `SUB name(args)` ... `END SUB` and `FUNCTION name(args) AS type` ... `RETURN value`. `EXIT SUB` leaves a SUB early. |
| `INKEY$`, `JOY()` | The library's `ScanKeys()` then `KeyDown(key)`, which can test several keys at once. |

The last rows come from the library's own notes (`docs/library.md`, **Performance tips**, section
"Other things that cost time or memory").

Two library ideas to keep in mind from the start:

- The CPC library has its **own coordinates**. `x` is in *bytes* (not pixels), `y` in pixel lines, from
  the top left. Tiles use cells. See **Coordinates** in `docs/library.md`.
- After every `MODE` or `Mode` call, call **`ScreenInit()`**. The mode change does not tell the library about the new
  screen; `ScreenInit()` does. See **Using the library**.

## Try this

1. In `platform_cpc.bas` change `MODE 1` to `MODE 0` and rebuild. What changes? (Mode 0 has 20
   text columns, so the `O` runs off the edge: the game's `x >= 28` test is for 40 columns.)
2. Select the `cpc6128` target and run it. Is anything different on screen?
3. Add a `PlatBeep` call: a `SUB PlatBeep()` in `platform_cpc.bas` that does `BEEP 1, 0`, and call it from `game.bas` when the `O` bounces.
   `game.bas` still never touches the sound chip itself: it only asks.

## What you have now

A project that builds for two targets, runs in an emulator tab, and has the shape of the finished
game.

One thing to know before you go on: Studio does not do *everything* the finished game's scripts do. The
art drawing, the splitting of the map into rooms, the size-limit checks and the Plus loader disc stay
outside it. Each chapter says so where it matters, and the [README](README.md#what-studio-does-not-do-for-this-game)
lists them in one place. Next: [Chapter 2, Palette and tiles](02-palette-and-tiles.md).
