# Chapter 9: Measuring

**Goal.** Find out whether the game fits and whether it is fast enough, with numbers rather than
feelings: read the build report, run the benchmark, and see what the finished game does to stay at 25
steps a second on a 464 with music.

**What you'll learn**

- How to read Studio's build report and the compiler's `.map` file.
- What the 464's memory budget is, and what Lamplighter uses.
- How to benchmark a game with a scripted run (`-D BENCH`) and read its output.
- Where the time goes in a step, and the four changes that made the difference.

**Time:** about 45 minutes. Every number in this chapter is either measured in front of you or
labelled with the file it was measured in (mostly `DESIGN.md`, sections 11 and 12 "As built").

**Before you start.** Chapter 8 is working. Keep your own code safe: copy `main.bas`, `game.bas` and
`platform_cpc.bas` to a folder outside the project (say `mine/`). Parts of this chapter use the finished
game's files.

---

## Step 1: Read the build report

Run **CPCBuild: Build** with the `cpc464` target. At the end of the **CPCBuild** output channel is
the build report. The report is plain text (a graphical report with a memory bar was planned and is not
built). For the finished game, whose size is 26,814 bytes (`DESIGN.md` section 12; the finished game's
`build_cpc.sh` prints the same size), it reads:

```
Build report for cpc464:
  26814 bytes, &0040-&68FE
    over back screen / banks (double buffering) (&4000) by 10494 bytes
    headroom below &8B60: 8802 bytes  [firmware heap start]
```

(The layout is `formatReport` in Studio's `map.ts`, checked against a screenshot of a real run; the
numbers are worked out from the 26,814 bytes: &0040 + 26,814 = &68FE, and &68FE - &4000 = 10,494.) Run
**CPCBuild: Show Build Report** to print the last one again. Your own build will be a few hundred bytes
different. The lines mean:

- **`26814 bytes, &0040-&68FE`**: the program's size and address range. Studio reads the start from the `.map`
  file the compiler writes next to the program (the label `.core.__START_PROGRAM`) and adds the size.
  A CPC program loads at `&0040` by default (library: **Program origin**).
- **`headroom below &8B60`**: the firmware's heap starts at `&8B60`; the program must end below it.
  From `&0040` that leaves about 34.8 KB (library: **Program origin**). Lamplighter ends at `&68FE`
  and has **8,802 bytes spare**: room to add rooms.
- **`over back screen / banks (double buffering) (&4000)`**: a reference line, not an error. A program that
  uses double buffering or the 6128's banks must stay below `&4000` because it reserves `&4000-&7FFF`.
  Lamplighter is single-buffered and keeps no banks, so it is "over" that line by design, and says so in lower case.
  A real limit that is exceeded says `OVER` in capitals. The build still finishes: Studio *reports* the
  limit, it does not stop the build. (The finished game's `build_cpc.sh` does stop, with a message, if the
  program ends above `&8B60`; that check is one of the things that stay outside Studio.)

You can add your own reference lines with the setting `cpcbuild.build.memoryLimits`, for
example `{ "my buffer": "0x7000" }`: each becomes another `headroom below` (or `OVER`) line. (A `bare`
target, chapter 11, gets different reference lines: `bare program loaded by RUN"` at `&A67B` for a disc,
and `bare limit` at `&B800`.)

### Where the bytes went

`DESIGN.md` section 4 budgeted the 464 build like this (estimates, bytes):

| Part | Estimate |
|---|---|
| Code: game, platform layer, the library routines used | 12,000 to 15,000 |
| Tiles: 16 x 32 (the design said 64 tiles; the game needs 16) | 512 |
| Sprites: 12 frames x 128 | 1,536 |
| Rooms: 12 x 460 | 5,520 |
| Room objects | about 300 |
| Music and effects | about 3,000 to 4,000 |
| Font | 0 to 800 |

The design's total was 25,000 to 29,000 bytes; the finished game is 26,814 (22,400 without sound), inside it.
(The 1,536 and 5,520 are exact: you saw them in the generated files' array sizes.)

To see for yourself, open `build/<name>.map`. It is a list of `address: label` lines. Sort it by address in
your head: the program's code comes first, the data arrays after. The library's own table
(**Performance tips**, "What each routine adds") says what each routine costs in bytes: for example
`PutSpriteMasked` 952, `TileMap` 779, `TileRestore` 1,047, `DoTile8` 485, `TextFont` plus `TextAt`
1,216. Add those up for the five calls Lamplighter uses and you have about 4.5 KB of library; the rest
is your code and data.

Studio also has views you can use once the emulator is running; this tutorial does not need them, but they
are worth a look. The **CPCBuild** icon in the Activity Bar opens three: **Symbols** (the map's labels,
grouped, with their addresses and, for variables, live values), **Registers** (the Z80's registers when the
program is stopped; its toolbar has Pause, Resume, Step, Step Over, Step Out and **Show Memory**) and
**Breakpoints** (a breakpoint is set on a symbol, with an offset). **CPCBuild: Show Memory** opens a
read-only hex view of 512 bytes with the changed bytes marked. While a program is stopped the status bar
says `CPC paused at PutSprite` (a symbol and offset); while it runs it says `CPC running`. These come from
the Phase 8 "As built" notes in `docs/phase8-design.md`. A watch list and memory writes are not built yet.

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
| one moved sprite, with the BASIC overhead (`DESIGN.md`) | about 26,000 |
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

Select it (**CPCBuild: Select Target**) and run **CPCBuild: Build and Run**. The game does not draw a title:
it plays the script, which takes about ten seconds at 25 steps a second, and then the screen shows:

```
INFO steps=250 frames=500 per second=25.0 late=2 longest=3
```

(The line is printed by the finished game's `main.bas:119`; the numbers here are illustrative. The finished
game's own measurement, `DESIGN.md` section 12: **25.0 steps a second, 499 frames**, with music.)
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
| silent, at the end of the game's first milestone (`DESIGN.md` section 11) | 460 | about 8 % |
| after the speed-ups of this chapter, silent (section 12) | 405 | about 19 % |
| same, with music | 430 | about 14 % |

(Headroom = (500 minus frames) / 500.) And paced, with music, the finished game gets **25.0 steps a second (499
frames)**; with game mode switched off (`NOGAMEMODE`) it gets **24.9 (503)**. So game mode is what
makes the room for music: the library says the same (**Frame hook and game mode**: music and effects
at 25.0 in game mode, 20.0 in normal mode, in the bounce demo).

Two more switches are useful for finding where time goes:

| Switch | Meaning |
|---|---|
| `NOPACE` | no frame wait: measure raw speed |
| `NOFLUSH` | no drawing: measure the logic alone |

Run once with `NOPACE`, once with `NOPACE` and `NOFLUSH`: the difference is the cost of drawing.

## Step 4: What made it fast

The BASIC versions of chapters 5 to 7 are too slow for a 464 at 25 steps a second, and the music
takes another 6 %. `DESIGN.md` records the changes that fixed it: for the first, "needed: `TileAttr` in
asm"; for the music, the other three. They are all in the finished files you just copied.

1. **`TileAttr` in assembly.** The BASIC function you wrote in chapter 5 costs about **2,560
   T-states** a call (`DESIGN.md` section 11), and a step makes many of them: the player's probes, the lamp and
   spike test, every walking enemy. In assembly it is **560** (section 11). Look at
   it in `game.bas:81-134`. It is Z80 code inside `ASM ... END ASM`, and it does exactly what the BASIC
   did: row times 20 plus column (as shifts and adds: 4 + 1 = 5, then times 4), plus the room's address, read
   the tile, `AND 15`, look it up in `TA_TAB` (the attribute table, which now lives in the assembly as a
   `defb` line).

   ```
   ld a, (ix+7)            ; cy
   ...
   add hl, hl
   add hl, hl              ; 4 cy
   add hl, de              ; 5 cy
   add hl, hl
   add hl, hl              ; 20 cy
   ```

   (`game.bas:110-120`.) `ix+5` and `ix+7` are the arguments, read from the stack frame: Boriel passes
   them there, and an assembly routine reads them itself (library, **Using the library**: assembly
   routines "read their arguments from the stack frame and return in registers").
2. **`ColSolid` and `WalkOK` in assembly** (they were about 10,000 T-states a call; `game.bas:358-391` and
   `581-637`). They share the cell-lookup code in `TileAttr`'s assembly through a label, `CELL_ATTR`.
3. **One call instead of six for lamps and spikes.** `TouchAttr` (`game.bas:141-209`) ORs the attributes of
   all cells under the hit box over the three rows and answers the common case, "nothing here", in one call.
   The BASIC `Touch` you wrote in chapter 7 made about six `TileAttr` calls and loops for the same answer.
4. **Visit only the enemies that move.** Chapter 6's `eTick` trick. Before, every enemy was visited every
   step: about **33,000 T-states**.

`DESIGN.md` adds the first milestone's own list: "enemies move every second step (half per step)" and
"overlap redraw only for a still player" (chapter 6). The result, from the table above: 460 frames
before sound, 430 after, with the music's 6 % included.

> **The lesson.** Measure first, then change one thing. Almost all of this game is plain BASIC; a few
> hot spots (called many times a step) are in assembly. The library's own advice
> (**Performance tips**): per-call overhead dominates, array indexing costs a few hundred T-states,
> gate (firmware) calls cost about 220 T-states more than the routine.

## Step 5: Tests (if you have the repository)

The finished game is tested, and the same checks run for the Spectrum and Plus builds. **None of this is
part of Studio**: the tests, the goldens and the size checks are scripts and Makefile targets in the
cpcbuild repository, and you run them from a terminal there:

```
make test-lamp        # 66 logic checks; 17 screenshot goldens on each CPC model, 17 + 4 on each Spectrum model
make reach-lamp       # about a minute: every lamp reachable, the tower finishable
games/lamplighter/tests/bench.sh      # the benchmark, all builds, headless
make test-lamp-plus   # the Plus builds on Caprice32 and CPCEC, about 3 minutes (DESIGN.md section 13)
```

(From `DESIGN.md`, sections 8 and 11 to 13. These need the repository's own tools and a built headless
emulator: `make chips`.) A **golden** is a saved screenshot of a known state; the test builds the game,
runs it to that state and compares pictures pixel for pixel. That is how the sound switches were checked
to change no pixel (chapter 8).

## Try this

1. Run the bench with `NOFLUSH` and `NOPACE`. What fraction of the step is drawing?
2. Time `TileAttr` alone. In a scratch program that includes your chapter 5 `game.bas` pieces, call the
   BASIC `TileAttr` 1,000 times in a loop and note `Frames()` before and after. Predict the answer first:
   at about 2,560 T-states a call, and 80,000 to a frame, how many frames? Then do the same with the
   assembly `TileAttr` (560 T-states) from the finished file. Were your predictions close?
3. Add `NOGAMEMODE` to the defines. How many frames, paced and unpaced?
4. Add `NOSOUND`, then `NOMUSIC`, then `NOSFX`. Which part of the sound costs the most time? The most bytes?
5. Add a memory limit line in settings (`cpcbuild.build.memoryLimits`) at `0x6000` and read the report.
6. Open the `.map`: what is the biggest thing in your program that is not code?

## What you have now

A game you can measure, and the habit of measuring it. Next:
[Chapter 10, The Spectrum build](10-the-spectrum-build.md).
