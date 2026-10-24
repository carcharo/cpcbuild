# Chapter 9: Measuring

**Goal.** Find out whether the game fits and whether it is fast enough, with numbers rather than
feelings: read the build report, run the benchmark, and see what the finished game does to stay at 25
steps a second on a 464 with music.

**What you'll learn**

- How to read Studio's build report and the compiler's `.map` file.
- What the 464's memory budget is, and what Lamplighter uses.
- How to benchmark a game with a scripted run (`-D BENCH`) and read its output.
- Where the time goes in a step, and how to measure the plain BASIC and assembly versions of the hot routines yourself.

**Time:** about 45 minutes. Every number in this chapter is either measured in front of you or
labelled with where it was measured.

**Before you start.** Chapter 8 is working. Keep your own code safe: copy `main.bas`, `game.bas` and
`platform_cpc.bas` to a folder outside the project (say `mine/`). Parts of this chapter use the finished
game's files.

---

## Step 1: Read the build report

Run **CPC Game Studio: Build** with the `cpc464` target. At the end of the **CPC Game Studio** output channel is
the build report. The report is plain text (a graphical report with a memory bar was planned and is not
built). For the finished game, whose size is 26,749 bytes (the finished game's
`build_cpc.sh` prints the same size), it reads:

```
Build report for cpc464:
  26749 bytes, &0040-&68BD
    passes &4000 by 10429 bytes (only matters if you use a back screen or banks)
    headroom below &8B60: 8867 bytes  [firmware heap start]
```

(The layout is `formatReport` in Studio's `map.ts`, checked against a screenshot of a real run; the
numbers are worked out from the 26,749 bytes: &0040 + 26,749 = &68BD, and &68BD - &4000 = 10,429.) Run
**CPC Game Studio: Show Build Report** to print the last one again. Your own build will be a few hundred bytes
different. The lines mean:

- **`26749 bytes, &0040-&68BD`**: the program's size and address range. Studio reads the start from the `.map`
  file the compiler writes next to the program (the label `.core.__START_PROGRAM`) and adds the size.
  A CPC program loads at `&0040` by default (library: **Program origin**).
- **`headroom below &8B60`**: the firmware's heap starts at `&8B60`; the program must end below it.
  From `&0040` that leaves about 34.8 KB (library: **Program origin**). Lamplighter ends at `&68BD`
  and has **8,867 bytes spare**: room to add rooms.
- **`passes &4000 by 10429 bytes`**: a reference line, not an error. A program that
  uses double buffering or the 6128's banks must stay below `&4000` because it reserves `&4000-&7FFF`.
  Lamplighter is single-buffered and keeps no banks, so it passes that line by design, and the line says it only matters if you use a back screen or banks.
  A real limit that is exceeded says `OVER` in capitals. The build still finishes: Studio *reports* the
  limit, it does not stop the build. (The finished game's `build_cpc.sh` does stop, with a message, if the
  program ends above `&8B60`; that check is one of the things that stay outside Studio.)

You can add your own reference lines with the setting `cpcbuild.build.memoryLimits`, for
example `{ "my buffer": "0x7000" }`: each becomes another `headroom below` (or `OVER`) line. (A `bare`
target, chapter 11, gets different reference lines: `bare program loaded by RUN"` at `&A67B` for a disc,
and `bare limit` at `&B800`.)

### Where the bytes went

The 464 build was budgeted like this at the start (estimates, bytes):

| Part | Estimate |
|---|---|
| Code: game, platform layer, the library routines used | 12,000 to 15,000 |
| Tiles: 16 x 32 (the design said 64 tiles; the game needs 16) | 512 |
| Sprites: 12 frames x 128 | 1,536 |
| Rooms: 12 x 460 | 5,520 |
| Room objects | about 300 |
| Music and effects | about 3,000 to 4,000 |
| Font | 0 to 800 |

The design's total was 25,000 to 29,000 bytes; the finished game is 26,749 (22,335 without sound, built with `-D NOSOUND`), inside it.
(The 1,536 and 5,520 are exact: you saw them in the generated files' array sizes.)

To see for yourself, open `build/<name>.map`. It is a list of `address: label` lines. Sort it by address in
your head: the program's code comes first, the data arrays after. The library's own table
(**Performance tips**, "What each routine adds") says what each routine costs in bytes: for example
`PutSpriteMasked` 952, `TileMap` 779, `TileRestore` 1,047, `DoTile8` 485, `TextFont` plus `TextAt`
1,216. Add those up for the five calls Lamplighter uses and you have about 4.5 KB of library; the rest
is your code and data.

Studio also has views you can use once the emulator is running; this tutorial does not need them, but they
are worth a look. The **CPC Game Studio** icon in the Activity Bar opens three: **Symbols** (the map's labels,
grouped, with their addresses and, for variables, live values), **Registers** (the Z80's registers when the
program is stopped; its toolbar has Pause, Resume, Step, Step Over, Step Out and **Show Memory**) and
**Breakpoints** (a breakpoint is set on a symbol, with an offset). **CPC Game Studio: Show Memory** opens a
read-only hex view of 512 bytes with the changed bytes marked. While a program is stopped the status bar
says `CPC paused at PutSprite` (a symbol and offset); while it runs it says `CPC running`. A watch list and memory writes are not built yet.

## Step 2: Think in frames

The CPC redraws the screen 50 times a second: one **frame** is 20 ms, which is **80,000 T-states**
(the library's unit: every instruction takes a whole number of microseconds, so counts are
"effective" T-states). Lamplighter takes one game step every **2 frames**, 25 steps a second, so a step
has about **160,000 T-states** to read the keys, move everything, draw and make sound.

The firmware's own interrupts take about 12 % of that unless game mode turns them off
(chapter 8). What a step costs, by the library's and the finished game's own figures:

| Item | Cost (T-states) |
|---|---|
| `PutSpriteMasked`, one 4 x 16 sprite | 5,283 |
| `TileRestore` of its old rectangle, not aligned to a tile | about 9,600 |
| one moved sprite, with the BASIC overhead | about 26,000 |
| `DoTile8`, one tile (library) | 1,546 in mode 0 |
| the music player, every frame | about 3,700 |
| a call from BASIC, any call | 1,000 to 2,000 |
| an array access with a variable index | about 350 |

Five moved sprites (the player and four enemies) cost about 130,000: almost the whole budget. That is why
chapter 6 moves half the enemies each step, and why the layer redraws only sprites that changed.

## Step 3: Benchmark with a scripted run

Guessing is slow, so the finished game has a benchmark built in. With `-D BENCH`, `main.bas` runs **250
logic steps** of a scripted walk in room 0 with **four enemies** (the worst case: two from the map and
two added in code), with no keys needed, then prints one line and stops. The target is 25.0 steps a second:
500 frames for 250 steps.

To run it you need the finished `main.bas`, `game.bas` and `platform_cpc.bas` (they have the benchmark hooks that
your chapter 8 versions lack). Copy them from `games/lamplighter/` into your project folder (replace yours; you
saved a copy). Then add a target to `cpcbuild.json`, beside `cpc464`:

```json
{ "id": "bench464", "arch": "cpc", "main": "main.bas", "model": "464",
  "defines": ["CPC464", "BENCH"], "package": "dsk", "disc": "LAMPLIGH" }
```

Select it (**CPC Game Studio: Select Target**) and run **CPC Game Studio: Build and Run**. The game does not draw a title:
it plays the script, which takes about ten seconds at 25 steps a second, and then the screen shows:

```
INFO steps=250 frames=500 per second=25.0 late=2 longest=3
```

(The line is printed by the finished game's `main.bas:119`; the numbers here are illustrative. The finished
game's own measurement on a 464, with music: `INFO steps=250 frames=499 per second=25.1 late=9 longest=3`.)
<!-- CHECK (for the user's test session): the line is printed with PRINT in mode 0, which has 20 columns, so it wraps over several rows; confirm it is readable in the emulator tab and not scrolled away when the program ends. If it is hard to read, the test harness reads the same line from the emulator's console (games/lamplighter/tests/bench.sh). -->

How to read it:

- **`per second`** is steps divided by time. 25.0 means every step fit in two frames.
- **`late`** counts steps that took more than two frames; **`longest`** is the longest one, in frames. A
  game can average 25.0 and still stutter if some steps are late. Add `BENCHLOG` to the defines and
  the first eight late steps are listed with their numbers.

### How much room is left?

The bench *paces* itself: each step waits for two frames. To see how much slack there is, switch the waiting
off. Add `NOPACE` to the target's defines. Now the steps run as fast as they can and the line reports
**frames used for 250 steps** (500 is the budget). Fewer is better:

| Build (464, unpaced; frames for 250 steps) | Frames | Headroom |
|---|---|---|
| silent, at the end of the game's first milestone | 460 | about 8 % |
| the finished game, silent (`NOPACE` and `NOSOUND`) | 406 | about 19 % |
| the finished game, with music (`NOPACE`) | 431 | about 14 % |

(Headroom = (500 minus frames) / 500. The first row is history; the other two are measured on the finished game.)
And paced, with music, the finished game gets **25.1 steps a second (499 frames, 9 late steps)**; with game mode
switched off (`NOGAMEMODE`) it gets **24.9 (502 frames, 15 late steps)**. So game mode is what
makes the room for music: the library says the same (**Frame hook and game mode**: music and effects
at 25.0 in game mode, 20.0 in normal mode, in the bounce demo).

Two more switches are useful for finding where time goes:

| Switch | Meaning |
|---|---|
| `NOPACE` | no frame wait: measure raw speed |
| `NOFLUSH` | no drawing: measure the logic alone |

Run once with `NOPACE`, once with `NOPACE` and `NOFLUSH`: the difference is the cost of drawing. With music, the finished game takes 431 frames with drawing and 199 without, so drawing costs 431 - 199 = 232 frames of the 431: a little over half a step.

## Step 4: What made it fast

The BASIC versions of chapters 5 to 7 are too slow for a 464 at 25 steps a second. The finished
`game.bas` has six hot routines written twice: `TileAttr`, `TouchAttr`, `ColSolid`, `WalkOK`,
`CopyRoom` and `ScanRoom`. Each is `#ifdef LAMP_BASIC` plain BASIC (the versions you wrote in chapters 5
to 7, or close to them) `#else` Z80 assembly `#endif`. The default build uses the assembly. Here you
build both and measure the difference.

1. Open `cpcbuild.json` and add `LAMP_BASIC` to the `defines` of the `bench464` target:

   ```json
   "defines": ["CPC464", "BENCH", "LAMP_BASIC"]
   ```

2. Run **CPC Game Studio: Build and Run**. The line is:

   ```
   INFO steps=250 frames=552 per second=22.6 late=51 longest=4
   ```

   Paced, plain BASIC manages 22.6 steps a second, with 51 late steps. Add `NOPACE` as well and it
   takes 551 frames for 250 steps. That is over the 500-frame budget, so **the game cannot hold 25
   steps a second in plain BASIC**. The build report says 26,949 bytes: 200 more than the assembly build's
   26,749.
3. Remove `LAMP_BASIC` again and run the bench. It is back to
   `INFO steps=250 frames=499 per second=25.1 late=9 longest=3`.

Both builds play the same game; `make test-lamp` (next step) checks that. Only the time differs. Here is
what each routine costs a call, measured on the chips emulator for the 464, net of an empty call (give or take
about 80 T-states):

| Routine | Plain BASIC (T-states) | Assembly (T-states) |
|---|---|---|
| `TileAttr` | 2,560 | 320 |
| `ColSolid` | 8,800 | 1,100 |
| `WalkOK` | 15,200 | 1,900 |
| `TouchAttr` | 56,600 | 3,800 |
| `CopyRoom` | 511,000 | 13,200 |
| `ScanRoom` | 471,000 | 27,000 |

Read it from the top. `TileAttr` is the bottom of everything: `ColSolid`, `WalkOK` and `TouchAttr` call it,
and a step makes many such calls: the player's probes, the lamp and spike
test, every walking enemy. Look at the assembly in `game.bas:102-155`. It does exactly what the BASIC did:
row times 20 plus column (as shifts and adds: 4 + 1 = 5, then times 4), plus the room's address, read the
tile, `AND 15`, look it up in `TA_TAB` (the attribute table, which lives in the assembly as a `defb` line).

```
ld a, (ix+7)            ; cy
...
add hl, hl
add hl, hl              ; 4 cy
add hl, de              ; 5 cy
add hl, hl
add hl, hl              ; 20 cy
```

(`game.bas:132-141`.) `ix+5` and `ix+7` are the arguments, read from the stack frame: Boriel passes them
there, and an assembly routine reads them itself (library, **Using the library**: assembly routines "read
their arguments from the stack frame and return in registers"). `ColSolid` and `WalkOK` share this
cell-lookup code through a label, `CELL_ATTR`. `TouchAttr` ORs the attributes of all cells under the hit
box over the three rows and answers the common case, "nothing here", in one call.

`CopyRoom` and `ScanRoom` are the two big ones, but they run only when a room loads. They are
different from the others: they do not speed up a step, they remove a pause. The play-test found a
1.7-second wait before the first room (`GameInit` counted the lamps by scanning the tower in BASIC) and a short
pause when a lamp was lit. With the block copy (`LDIR`) and the one-pass scan, and the lamp total
written into the data at build time, `GameInit` went from 89 to 9 frames, a room change from 25 to 9 frames
and `LightLamp` from 7 to 0.

The first milestone also needed two changes of design, which the build you measured already has, and which
are not in assembly: enemies move every second step, half of them on each step (chapter 6's `eTick`; before,
every enemy was visited every step, about **33,000 T-states**), and only a still player's overlap is
redrawn. Music costs the rest: from 406 to 431 frames.

> **The lesson.** Measure first, then change one thing. Almost all of this game is plain BASIC; a few
> hot spots (called many times a step) are in assembly, and the `LAMP_BASIC` switch lets you check the
> difference rather than take it on trust. The library's own advice
> (**Performance tips**): per-call overhead dominates, array indexing costs a few hundred T-states,
> gate (firmware) calls cost about 220 T-states more than the routine.

## Step 5: Tests (if you have the repository)

The finished game is tested, and the same checks run for the Spectrum and Plus builds. **None of this is
part of Studio**: the tests, the goldens and the size checks are scripts and Makefile targets in the
cpcbuild repository, and you run them from a terminal there:

```
make test-lamp        # logic checks and the whole-tower playthrough on every build, again with LAMP_BASIC on the 464 and 48K; screenshot goldens, two of them with LAMP_BASIC (88 tests in the latest run)
make reach-lamp       # about a minute: every lamp reachable, the tower finishable, and enemy patrols clear of doors, exits and entries
games/lamplighter/tests/bench.sh      # the benchmark, all builds, headless
make test-lamp-plus   # the Plus builds on Caprice32 and CPCEC, about 3 minutes (84 tests in the latest run)
```

(The tests are in `games/lamplighter/tests/run.py`. These need the repository's own tools and a built headless
emulator: `make chips`.) A **golden** is a saved screenshot of a known state; the test builds the game,
runs it to that state and compares pictures pixel for pixel. That is how the sound switches were checked
to change no pixel (chapter 8), and how the `LAMP_BASIC` build is checked to draw the same pictures as the
assembly one.

## Try this

1. Run the bench with `NOFLUSH` and `NOPACE`. What fraction of the step is drawing?
2. Time `TileAttr` alone. In a scratch program that includes your chapter 5 `game.bas` pieces, call the
   BASIC `TileAttr` 1,000 times in a loop and note `Frames()` before and after. Predict the answer first:
   at about 2,560 T-states a call, and 80,000 to a frame, how many frames? Then do the same with the
   assembly `TileAttr` (320 T-states, net of the call overhead) from the finished file. The loop and the call add
   their own cost, so expect more than the net figures. Were your predictions close?
3. Add `NOGAMEMODE` to the defines. How many frames, paced and unpaced?
4. Add `NOSOUND`, then `NOMUSIC`, then `NOSFX`. Which part of the sound costs the most time? The most bytes?
5. Add a memory limit line in settings (`cpcbuild.build.memoryLimits`) at `0x6000` and read the report.
6. Open the `.map`: what is the biggest thing in your program that is not code?

## What you have now

A game you can measure, and the habit of measuring it. Next:
[Chapter 10, The Spectrum build](10-the-spectrum-build.md).
