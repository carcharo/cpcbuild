# Chapter 9: Measuring

**Goal.** Find out whether the game fits and whether it is fast enough, with numbers rather than
feelings. You measure the all-BASIC game you built in chapters 5 to 8, then bring in six routines
of Z80 assembly, one at a time. Each one goes in only after a figure says it is worth it, and you
measure again after each. At the end the game holds 25 steps a second on a 464 with music.

**What you'll learn**

- How to read Studio's build report and the compiler's `.map` file.
- What the 464's memory budget is, and what Lamplighter uses.
- How to benchmark a game with a scripted run (`-D BENCH`) and read its output.
- Where the time goes in a step, and how to switch a routine between plain BASIC and assembly, so you can measure both.
- What each of the six assembly routines does, and what it gained.

**Time:** about 90 minutes: one rebuild and one benchmark run for each of the six routines, plus the
reading. Every number in this chapter was measured on the chips emulator by the commands shown, or is
labelled with where it came from.

**Before you start.** Chapter 8 is working. Keep your own code safe: copy `main.bas`, `game.bas` and
`platform_cpc.bas` to a folder outside the project (say `mine/`): in Finder on macOS, File Explorer on
Windows, or your file manager on Linux, or with **Copy** and **Paste** in VS Code's Explorer. This chapter
is the first with assembly in it, and you do not need to know Z80 to follow it: each routine is printed
in full, with what it does in words and a figure for what it gains. You paste each one in; you do not have to write it.

You run **CPC Game Studio** commands from the Command Palette: `Ctrl+Shift+P` on Windows and Linux,
`Cmd+Shift+P` on macOS.

---

## Step 1: Read the build report

Run **CPC Game Studio: Build** with the `cpc464` target. At the end of the **CPC Game Studio** output channel is
the build report. The report is plain text (a graphical report with a memory bar was planned and is not
built). For the finished game built with every routine in plain BASIC (`-D LAMP_BASIC`), whose size is 26,949 bytes, it reads:

```
Build report for cpc464:
  26949 bytes, &0040-&696D
    passes &4000 by 10605 bytes (only matters if you use a back screen or banks)
    headroom below &8B60: 8691 bytes  [firmware heap start]
```

(The layout is `formatReport` in Studio's `map.ts`, checked against a screenshot of a real run; the
numbers are worked out from the 26,949 bytes: &0040 + 26,949 = &696D, &696D - &4000 = 10,605 and
&8B60 - &696D = 8,691.) Run
**CPC Game Studio: Show Build Report** to print the last one again. Your own build will be a few hundred bytes
different. The lines mean:

- **`26949 bytes, &0040-&696D`**: the program's size and address range. Studio reads the start from the `.map`
  file the compiler writes next to the program (the label `.core.__START_PROGRAM`) and adds the size.
  A CPC program loads at `&0040` by default (library: **Program origin**).
- **`headroom below &8B60`**: the firmware's heap starts at `&8B60`; the program must end below it.
  From `&0040` that leaves about 34.8 KB (library: **Program origin**). The all-BASIC Lamplighter ends at `&696D`
  and has **8,691 bytes spare**: room to add rooms. (With the assembly of this chapter it will be 8,867.)
- **`passes &4000 by 10605 bytes`**: a reference line, not an error. A program that
  uses double buffering or the 6128's banks must stay below `&4000` because it reserves `&4000-&7FFF`.
  Lamplighter is single-buffered and keeps no banks, so it passes that line by design, and the line says it only matters if you use a back screen or banks.
  A real limit that is exceeded says `OVER` in capitals. The build still finishes: Studio *reports* the
  limit, it does not stop the build. (The finished game's `build_cpc.sh` does stop, with a message, if the
  program ends above `&8B60`. That is a shell script in the repository, not part of Studio, and it needs
  `poetry`; the tutorial never needs it, and we have not tried it on Windows.)

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

The design's total was 25,000 to 29,000 bytes; the finished game is 26,749 (22,335 without sound, built with `-D NOSOUND`), inside it, and the all-BASIC one is 26,949 (22,535 without sound).
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

The benchmark needs hooks that your chapter 8 `main.bas` and `platform_cpc.bas` lack, so copy the finished
`main.bas` and `platform_cpc.bas` from `games/lamplighter/` (in your repository checkout, or in the SDK
folder) into your project folder, replacing yours (you saved copies). **Keep your own `game.bas`**: it is the
code being measured. Then add a target to `cpcbuild.json`, beside `cpc464`:

```json
{ "id": "bench464", "arch": "cpc", "main": "main.bas", "model": "464",
  "defines": ["CPC464", "BENCH"], "package": "dsk", "disc": "LAMPLIGH" }
```

Select it (**CPC Game Studio: Select Target**) and run **CPC Game Studio: Build and Run**. The game does not draw a title:
it plays the script, which takes about ten seconds at 25 steps a second (a little longer for the slower
builds), and then the screen shows one line. For your all-BASIC game:

```
INFO steps=250 frames=552 per second=22.6 late=51 longest=4
```

(The line is printed by the finished game's `main.bas:119`. These numbers were measured on a 464 with the
repository's headless chips emulator, with the music playing; the same program in the emulator tab should print
the same line, but check yours and see the note at the end of this step.)
<!-- CHECK (for the user's test session): (1) the line is printed with PRINT in mode 0, which has 20 columns, so it wraps over several rows; confirm it is readable in the emulator tab and not scrolled away when the program ends. If it is hard to read, the test harness reads the same line from the emulator's console (games/lamplighter/tests/bench.sh). (2) confirm the emulator tab prints the same figures as chips (552 / 22.6 / 51 for the all-BASIC build, 499 / 25.1 / 9 with all six routines). -->

How to read it:

- **`per second`** is steps divided by time. 25.0 means every step fit in two frames. Yours says **22.6**: the
  all-BASIC game is too slow for a 464.
- **`late`** counts steps that took more than two frames; **`longest`** is the longest one, in frames. A
  game can average 25.0 and still stutter if some steps are late. Yours has 51 late steps out of 250. Add `BENCHLOG` to the defines and
  the first eight late steps are listed with their numbers.

### How much room is left?

The bench *paces* itself: each step waits for two frames. To see how much slack there is, switch the waiting
off. Add `NOPACE` to the target's defines. Now the steps run as fast as they can and the line reports
**frames used for 250 steps** (500 is the budget). Fewer is better. For your game:

```
INFO steps=250 frames=551 per second=22.7 late=51 longest=3
```

551 frames is more than 500, so **the all-BASIC game cannot hold 25 steps a second on a 464**, however
you pace it: it is 51 frames, about 10 %, over budget. The rest of the chapter gets it under.
Here are the unpaced figures you will reach, and one from history, for comparison:

| Build (464, unpaced; frames for 250 steps) | Frames | Headroom |
|---|---|---|
| your game, all in plain BASIC, with music | 551 | none: 10 % over |
| silent, at the end of the game's first milestone | 460 | about 8 % |
| the finished game, with music, all six routines in assembly (`NOPACE`) | 431 | about 14 % |
| the finished game, silent, all six in assembly (`NOPACE` and `NOSOUND`) | 406 | about 19 % |

(Headroom = (500 minus frames) / 500. The second row is history; the others are measured on the finished game.)
Paced, with music and all six routines in assembly, the finished game gets **25.1 steps a second (499 frames, 9 late steps)**; with game mode
switched off (`NOGAMEMODE`) it gets **24.9 (502 frames, 15 late steps)**. So game mode is what
makes the room for music: the library says the same (**Frame hook and game mode**: music and effects
at 25.0 in game mode, 20.0 in normal mode, in the bounce demo).

Two more switches are useful for finding where time goes:

| Switch | Meaning |
|---|---|
| `NOPACE` | no frame wait: measure raw speed |
| `NOFLUSH` | no drawing: measure the logic alone |

Run once with `NOPACE`, once with `NOPACE` and `NOFLUSH`: the difference is the cost of drawing. With music, the finished game takes 431 frames with drawing and 199 without, so drawing costs 431 - 199 = 232 frames of the 431: a little over half a step.

## Step 4: Where to look first

You have a game that is 51 frames over budget. Do not guess where. Look at what each hot routine
costs a call, in plain BASIC and in assembly, measured on the chips emulator for the 464, net of an empty call
(give or take about 80 T-states):

| Routine | Plain BASIC (T-states) | Assembly (T-states) |
|---|---|---|
| `TileAttr` | 2,560 | 320 |
| `ColSolid` | 8,800 | 1,100 |
| `WalkOK` | 15,200 | 1,900 |
| `TouchAttr` | 56,600 | 3,800 |
| `CopyRoom` | 511,000 | 13,200 |
| `ScanRoom` | 471,000 | 27,000 |

(A frame is 80,000 T-states, so BASIC `CopyRoom` is about 6.4 frames a call.) These six are the routines
you wrote in plain BASIC in chapters 5 to 7. They are the game's hot spots for two different reasons:

- **`TileAttr`, `ColSolid`, `WalkOK`, `TouchAttr`** run during play: the player's probes, the lamp and
  spike test and every walking enemy ask what is in a cell, again and again, every step. `TileAttr` is the bottom of
  all of them: `ColSolid`, `WalkOK` and `TouchAttr` call it.
- **`CopyRoom` and `ScanRoom`** are enormous per call but run only when a room loads. They do not slow
  a step: they make a pause. The bench never changes room, so it cannot see them; Step 9 measures them another way.

### A switch for each routine

The finished `game.bas` has each of the six written twice. You will do the same in your own copy, with
one switch for each, so that you can turn assembly on one routine at a time from the target's `defines`
and nothing else changes. Around each routine, the pattern is:

```basic
#ifdef ASM_TILEATTR
  ... the assembly version ...
#else
  ... the plain BASIC version you wrote ...
#endif
```

The `#ifdef`, `#else` and `#endif` words start in the first column of the line. With the define missing,
the compiler sees only the BASIC, exactly as before. With `"ASM_TILEATTR"` in the target's `defines`, it
sees only the assembly. The calls do not change, so nothing else in the game does. (The finished `game.bas`
has the same pairs, but with the opposite default: one switch, `LAMP_BASIC`, turns all six back to BASIC, and
that is how the figures for "all BASIC" in this chapter can be checked against the finished file.)

Each of the steps below asks for one rebuild and two bench runs, paced and with `NOPACE`. To change what the
bench builds, you edit the `defines` list of the `bench464` target in `cpcbuild.json`; start with:

```json
"defines": ["CPC464", "BENCH"]
```

## Step 5: TileAttr

`TileAttr(cx, cy)` is the foundation, and it is the first to go in. In BASIC, one call works out
`cy * 20 + cx` (a multiplication), reads `cur`, masks the tile with `AND 15`, and looks that up in `taTab` (a
second array access): about 2,560 T-states. In assembly the same steps take 320.

Find `TileAttr` in your `game.bas` (chapter 5) and wrap it, keeping your BASIC version as the `#else` part:

```basic
#ifdef ASM_TILEATTR
FUNCTION TileAttr(cx AS UBYTE, cy AS UBYTE) AS UBYTE
  ASM
  jp TA_GO
TA_TAB:                   ; the attributes of tiles 0-15 (assets/tiles.png)
  defb 0, 1, 2, 4, 8, 16, 0, 1, 0, 0, 0, 0, 6, 0, 0, 0
CELL_ATTR:                ; B = column, C = row -> A = the cell's attributes (keeps BC)
  ld a, c
  ld l, a
  ld h, 0
  ld e, a
  ld d, 0
  add hl, hl
  add hl, hl
  add hl, de
  add hl, hl
  add hl, hl
  ld e, b
  ld d, 0
  add hl, de
  ld de, _cur.__DATA__
  add hl, de
  ld a, (hl)
  and 15
  ld e, a
  ld d, 0
  ld hl, TA_TAB
  add hl, de
  ld a, (hl)
  ret
TA_GO:
  ld a, (ix+7)            ; cy
  ld l, a
  ld h, 0
  ld e, a
  ld d, 0
  add hl, hl
  add hl, hl              ; 4 cy
  add hl, de              ; 5 cy
  add hl, hl
  add hl, hl              ; 20 cy
  ld a, (ix+5)            ; cx
  ld e, a
  add hl, de
  ld de, _cur.__DATA__
  add hl, de
  ld a, (hl)              ; the tile
  and 15
  ld e, a
  ld d, 0
  ld hl, TA_TAB
  add hl, de
  ld a, (hl)
  END ASM
END FUNCTION
#else
' ... your BASIC TileAttr from chapter 5, unchanged ...
#endif
```

(This is `game.bas:102-155`. Your BASIC version stays below it, in the `#else` part, then `#endif`; the line
`DIM taTab(15)...` stays where it was, above the `#ifdef`.)

What it does, in words, so you can follow the listing:

- `ASM` and `END ASM` mark the assembly inside a Boriel function. Boriel passes the arguments on the stack
  and an assembly routine reads them itself (library, **Using the library**: assembly routines "read their
  arguments from the stack frame and return in registers"). `ix+5` is `cx`, `ix+7` is `cy`. The answer goes back in `A`.
- `jp TA_GO` jumps over two things that sit in the middle, because other routines will use them: `TA_TAB`, the
  16-byte attribute table (the same numbers as your `taTab`, now as a `defb` line), and `CELL_ATTR`, a
  small routine that takes a column in `B` and a row in `C` and returns that cell's attributes in `A`.
- `TA_GO` is the same job for the arguments on the stack. Row times 20 is done with shifts and adds, as
  the comments show: `add hl, hl` twice makes row x 4, adding the row back makes x 5, and two more doublings make x 20. Then it adds `cx`
  and the address of `cur`, reads the tile, keeps the low 4 bits (`and 15`) and looks the result up in `TA_TAB`.

Now measure. Add `ASM_TILEATTR` to the `defines` and run the bench, paced and then with `NOPACE`:

```
INFO steps=250 frames=500 per second=25.0 late=12 longest=3
INFO steps=250 frames=450 per second=27.7 late=1 longest=3
```

That one routine takes the unpaced run from 551 frames to 450 (101 frames, 18 % less) and the paced run from 22.6 steps
a second with 51 late steps to 25.0 with 12. The game now makes its target, just. The build is 26,964 bytes, 15
more than all-BASIC.

## Step 6: ColSolid

`ColSolid(c, y)` asks whether column `c` is solid at any of three heights. It calls `TileAttr` three times and
tests the answers. In BASIC that is 8,800 T-states, almost all of it three calls and the work around them. In assembly it
calls `CELL_ATTR` directly, with no stack frame in between: 1,100.

`ColSolid`'s assembly uses `CELL_ATTR`, which lives inside `TileAttr`'s assembly. **So turn on
`ASM_TILEATTR` first, and keep it on.** Wrap `ColSolid` the same way:

```basic
#ifdef ASM_COLSOLID
FUNCTION ColSolid(c AS UBYTE, y AS UBYTE) AS UBYTE
  ASM
  ld b, (ix+5)            ; the column
  ld a, (ix+7)            ; y
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr nz, CS_YES
  ld a, (ix+7)
  add a, 8
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr nz, CS_YES
  ld a, (ix+7)
  add a, 15
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr CS_DONE
CS_YES:
  ld a, 1
CS_DONE:
  END ASM
END FUNCTION
#else
' ... your BASIC version, unchanged ...
#endif
```

(`game.bas:509-542`.) `ix+5` is `c` and `ix+7` is `y`. For each of the three rows `y`, `y + 8` and `y + 15` it
shifts right three times (the `>> 3` of your BASIC), calls `CELL_ATTR` and tests bit 0, solid. The first solid cell
jumps to `CS_YES`, which answers 1; otherwise it answers with the last test's result.

Add `ASM_COLSOLID` and bench:

```
INFO steps=250 frames=499 per second=25.1 late=7 longest=3
INFO steps=250 frames=445 per second=28.1 late=2 longest=3
```

Unpaced: 5 frames faster (450 to 445). Paced: late steps down from 12 to 7. The program gets 17 bytes smaller (26,947). It is a
small win, and it costs nothing to keep.

## Step 7: WalkOK

`WalkOK(x, y, dir)` is the walkers' test: is the column in front free, no spikes at the feet, ground under it?
It calls `ColSolid` and `TileAttr` twice more. In BASIC: 15,200 T-states a call, and every walker that moves makes one; in assembly: 1,900.

```basic
#ifdef ASM_WALKOK
FUNCTION WalkOK(x AS UBYTE, y AS UBYTE, dir AS UBYTE) AS UBYTE
  ASM
  ld a, (ix+9)            ; dir
  cp 1
  ld a, (ix+5)            ; x
  jr nz, WK_COL
  add a, 7                ; going right: the right edge
WK_COL:
  srl a
  srl a
  srl a
  ld b, a                 ; the column in front
  ld a, (ix+7)            ; y
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr nz, WK_NO            ; a wall (rows y, y+8, y+15)
  ld a, (ix+7)
  add a, 8
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr nz, WK_NO
  ld a, (ix+7)
  add a, 15
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR
  and 1
  jr nz, WK_NO
  call CELL_ATTR          ; (row y+15 again: the spikes)
  and 8
  jr nz, WK_NO
  ld a, (ix+7)
  add a, 16
  srl a
  srl a
  srl a
  ld c, a
  call CELL_ATTR          ; the ground under it
  and 3
  jr z, WK_NO
  ld a, 1
  jr WK_DONE
WK_NO:
  xor a
WK_DONE:
  END ASM
END FUNCTION
#else
' ... your BASIC version, unchanged ...
#endif
```

(`game.bas:745-801`.) It is `ColSolid` and then two more `CELL_ATTR` calls (spikes in row `y + 15`, ground at `y + 16`), with a
jump to `WK_NO` on the first thing that says no. Again it needs `ASM_TILEATTR`.

Add `ASM_WALKOK`:

```
INFO steps=250 frames=499 per second=25.1 late=7 longest=3
INFO steps=250 frames=442 per second=28.2 late=2 longest=3
```

Another 3 frames unpaced (445 to 442), and the late steps stay at 7. The size drops by 13 bytes (26,934). In
this bench `WalkOK` buys little: it has two walkers, and each moves only every second step.

## Step 8: TouchAttr

`TouchAttr(l, r, y)` runs every step: it is the "is the player on a lamp or on spikes?" test, and the
common answer is "no". In BASIC it is `TouchRow` three times, each a loop of `TileAttr` calls: 56,600 T-states. In
assembly it is 3,800.

Wrap both `TouchRow` and `TouchAttr` in one pair, with the assembly first and both BASIC functions in the `#else` part:

```basic
#ifdef ASM_TOUCHATTR
FUNCTION TouchAttr(l AS UBYTE, r AS UBYTE, y AS UBYTE) AS UBYTE
  ASM
  jp TOUCH_GO
TOUCH_ROW:                ; A = row; returns A = the attributes of cells l..r OR'd
  ld l, a
  ld h, 0
  ld e, a
  ld d, 0
  add hl, hl
  add hl, hl
  add hl, de
  add hl, hl
  add hl, hl              ; 20 row
  ld de, _cur.__DATA__
  add hl, de
  ld e, (ix+5)            ; l
  ld d, 0
  add hl, de              ; the cell (l, row)
  ld a, (ix+7)            ; r
  sub (ix+5)
  inc a
  ld b, a                 ; cells to read
  ld c, 0
TOUCH_CELL:
  ld a, (hl)
  and 15
  push hl
  ld e, a
  ld d, 0
  ld hl, TA_TAB
  add hl, de
  ld a, (hl)
  or c
  ld c, a
  pop hl
  inc hl
  djnz TOUCH_CELL
  ld a, c
  ret
TOUCH_GO:
  ld a, (ix+9)            ; y
  srl a
  srl a
  srl a
  call TOUCH_ROW
  and 16                  ; the top row: lamps only
  ld d, a
  ld a, (ix+9)
  add a, 8
  srl a
  srl a
  srl a
  push de
  call TOUCH_ROW
  pop de
  or d
  ld d, a
  ld a, (ix+9)
  add a, 15
  srl a
  srl a
  srl a
  push de
  call TOUCH_ROW
  pop de
  or d
  and 24
  END ASM
END FUNCTION
#else
' ... your BASIC version, unchanged ...
#endif
```

(`game.bas:184-252`.) `TOUCH_ROW` takes a row in `A` and ORs together the attribute of every cell from `l` to `r` in
that row: it computes the address of the first cell once, then walks along the row with `djnz` (decrement `B` and
loop), looking each tile up in `TA_TAB` (so this one also needs `ASM_TILEATTR`). `TOUCH_GO` calls it for the three rows, keeps
only the lamp bit from the first, and returns the OR masked with 24 (lamp and hazard).

Add `ASM_TOUCHATTR`:

```
INFO steps=250 frames=499 per second=25.1 late=7 longest=3
INFO steps=250 frames=431 per second=29.0 late=2 longest=3
```

Unpaced it saves 11 frames (442 to 431), the second biggest win. The program shrinks by 56 bytes (26,878).

## Step 9: CopyRoom and ScanRoom

These two do not change the bench: with them in assembly the unpaced figure is 430 and then 431, a frame either
way, and the paced figure stays at 25.1. They matter when you walk through a door. To see it, add a
little timing code to your copy of `main.bas` (the one you copied in step 3). Find the line `PlatInit()` near the
bottom, and put this straight after it:

```basic
#ifdef LOADBENCH
DIM lbT, lbN AS UINTEGER
lbT = PlatFrames()
FOR lbN = 1 TO 20
#ifdef LB_COPY
  CopyRoom(@rooms(0) + 9 * ROOM_SIZE)
#endif
#ifdef LB_SCAN
  ScanRoom()
#endif
#ifdef LB_LOAD
  LoadRoom(9)
#endif
#ifdef LB_ENTER
  EnterRoom(9, 255, 0)
#endif
NEXT lbN
lbT = PlatFrames() - lbT
PlatEnd()
PRINT "INFO loads=20 frames="; lbT
END
#endif
```

It does one job 20 times and prints how many frames that took. Make a second target, `load464`, beside `bench464`, with
`"defines": ["CPC464", "BENCH", "LOADBENCH", "LB_COPY"]` (`BENCH` is there because it switches on the two platform
hooks that the timing code uses, `PlatFrames` and `PlatEnd`; the timing code ends the program before the
benchmark would start). The `LB_` define picks the job:
`LB_COPY` (`CopyRoom` alone), `LB_SCAN` (`ScanRoom` alone), `LB_LOAD` (`LoadRoom`: both, and the objects) and
`LB_ENTER` (`EnterRoom`: everything that happens on a room change, including drawing the room).

Run each with the plain BASIC routines, then with the assembly. Wrap `CopyRoom` and `ScanRoom` in `ASM_COPYROOM` and `ASM_SCANROOM` pairs first:

```basic
#ifdef ASM_COPYROOM
SUB CopyRoom(src AS UINTEGER)
  ASM
  ld l, (ix+4)
  ld h, (ix+5)            ; src
  ld de, _cur.__DATA__
  ld bc, 460              ; ROOM_SIZE
  ldir
  END ASM
END SUB
#else
' ... your BASIC version, unchanged ...
#endif
```

(`game.bas:268-276`: a block copy. `ldir` copies `bc` bytes from the address in `hl` to the one in `de`, here 460 bytes
from the room's address, passed as the argument, to `cur`. The address comes from BASIC because an array used only from
assembly would be dropped by the compiler.)

```basic
#ifdef ASM_SCANROOM
SUB ScanRoom()
  ASM
  xor a
  ld (_nLamp), a
  ld (_nDoor), a
  ld hl, _cur.__DATA__
  ld bc, 460
  ld de, _lampCell.__DATA__
  ld a, 5                 ; T_LAMP
SR_LAMP:
  cpir
  jr nz, SR_LAMPS_DONE
  call SR_STORE
  ld a, (_nLamp)
  inc a
  ld (_nLamp), a
  ld a, b
  or c
  ld a, 5
  jr nz, SR_LAMP
SR_LAMPS_DONE:
  ld hl, _cur.__DATA__
  ld bc, 460
  ld de, _doorCell.__DATA__
  ld a, 7                 ; T_DOOR
SR_DOOR:
  cpir
  jr nz, SR_END
  call SR_STORE
  ld a, (_nDoor)
  inc a
  ld (_nDoor), a
  ld a, b
  or c
  ld a, 7
  jr nz, SR_DOOR
  jr SR_END
SR_STORE:                 ; HL just past a match, DE the list's next entry
  push hl
  push bc
  dec hl
  ld bc, _cur.__DATA__
  or a
  sbc hl, bc              ; the cell index
  ex de, hl
  ld (hl), e
  inc hl
  ld (hl), d
  inc hl
  ex de, hl               ; DE the next entry again
  pop bc
  pop hl
  ret
SR_END:
  END ASM
END SUB
#else
' ... your BASIC version, unchanged ...
#endif
```

(`game.bas:301-356`. `cpir` searches memory for the byte in `A`, here tile 5, stopping at each match; `SR_STORE`
turns the address into a cell number and stores it in `lampCell`. Then the same for tile 7 and `doorCell`.)

The results, for 20 repetitions (frames):

| Job | Plain BASIC | Assembly |
|---|---|---|
| `LB_COPY`: `CopyRoom` | 127 | 3 |
| `LB_SCAN`: `ScanRoom` | 117 | 6 |
| `LB_LOAD`: `LoadRoom` (copy and scan both in assembly) | 249 | 14 |
| `LB_ENTER`: `EnterRoom`, all six routines in assembly | 420 | 184 |

So loading a room takes about 12 frames (a quarter of a second) in plain BASIC, and less than one frame in
assembly. A whole room change, with the drawing, goes from 21 frames to 9. You would notice 21 frames, well over a third of a second of
nothing, every time you cross a door. The program shrinks by 63 bytes for `CopyRoom` (26,878 to 26,815) and a further 66 for `ScanRoom` (26,749).
The full build now matches the finished game: **26,749 bytes**, `&0040-&68BD`, and the report shows 8,867 bytes of headroom.

## Step 10: Add it up

All six switched on is the shipped game. The ladder you climbed, on a 464 with music, 250 steps of the bench:

| Routine added (cumulative) | Paced: frames, steps/s, late | Unpaced: frames | Program size (bytes) |
|---|---|---|---|
| none: all plain BASIC | 552, 22.6, 51 | 551 | 26,949 |
| `TileAttr` | 500, 25.0, 12 | 450 | 26,964 |
| + `ColSolid` | 499, 25.1, 7 | 445 | 26,947 |
| + `WalkOK` | 499, 25.1, 7 | 442 | 26,934 |
| + `TouchAttr` | 499, 25.1, 7 | 431 | 26,878 |
| + `CopyRoom` | 499, 25.1, 8 | 430 | 26,815 |
| + `ScanRoom` (all six) | 499, 25.1, 9 | 431 | 26,749 |

Read the table the way you would read your own. `TileAttr` is where almost all the time was: one routine
brought the game from too slow to 25 steps a second. `ColSolid` brings the late steps from 12 down to 7, `WalkOK` and `TouchAttr` take more frames off the unpaced
run, and the last two make rooms load without a pause. Notice what did *not* change: the unpaced figure is 430 or 431 for the last
three rows, and the late-step count moves from 7 to 8 to 9 without a matching change in anything else, so do not read
much into one or two late steps. The rest of the game is still plain BASIC.

Both builds play the same game. `make test-lamp` (next step) checks that. The finished game gets two more speed-ups that are not in
assembly: enemies move every second step, half of them on each step (chapter 6's `eTick`; before, every enemy was visited every step,
about **33,000 T-states**), and only a still player's overlap is redrawn. Music costs the rest: from 406 to 431 frames.

> **The lesson.** Measure first, then change one thing. Almost all of this game is plain BASIC; six hot spots
> are in assembly, and the `#ifdef` switch lets you check each difference rather than take it on trust. The library's own advice
> (**Performance tips**): per-call overhead dominates, array indexing costs a few hundred T-states,
> gate (firmware) calls cost about 220 T-states more than the routine.

## Step 11: Tests (if you have the repository)

The finished game is tested, and the same checks run for the Spectrum and Plus builds. **None of this is
part of Studio**: the tests, the goldens and the size checks are scripts and Makefile targets in the
cpcbuild repository, and you run them from a terminal there. They are written for a Unix shell and `make`:
they run on macOS and Linux, and we have not tried them on Windows. If you are on Windows, the Studio steps
above (Build and Run with the `bench464` target) give you the numbers in this chapter without them.

```
make test-lamp        # logic checks and the whole-tower playthrough on every build, again with LAMP_BASIC on the 464 and 48K; screenshot goldens, two of them with LAMP_BASIC (88 tests in the latest run)
make reach-lamp       # about a minute: every lamp reachable, the tower finishable, and enemy patrols clear of doors, exits and entries
games/lamplighter/tests/bench.sh      # the benchmark, all builds, headless
make test-lamp-plus   # the Plus builds on Caprice32 and CPCEC, about 3 minutes (84 tests in the latest run)
```

(The tests are in `games/lamplighter/tests/run.py`. These need the repository's own tools and a built headless
emulator: `make chips`, which needs a C compiler.) A **golden** is a saved screenshot of a known state; the test builds the game,
runs it to that state and compares pictures pixel for pixel. That is how the sound switches were checked
to change no pixel (chapter 8), and how the `LAMP_BASIC` build is checked to draw the same pictures as the
assembly one.

## Try this

1. Run the bench with `NOFLUSH` and `NOPACE`. What fraction of the step is drawing?
2. Time `TileAttr` alone. In a scratch program that includes your chapter 5 `game.bas` pieces, call the
   BASIC `TileAttr` 1,000 times in a loop and note `Frames()` before and after. Predict the answer first:
   at about 2,560 T-states a call, and 80,000 to a frame, how many frames? Then do the same with the
   assembly `TileAttr` (320 T-states, net of the call overhead). The loop and the call add
   their own cost, so expect more than the net figures. Were your predictions close?
3. Add `NOGAMEMODE` to the defines. How many frames, paced and unpaced?
4. Add `NOSOUND`, then `NOMUSIC`, then `NOSFX`. Which part of the sound costs the most time? The most bytes?
5. Add a memory limit line in settings (`cpcbuild.build.memoryLimits`) at `0x6000` and read the report.
6. Open the `.map`: what is the biggest thing in your program that is not code?
7. Turn on `ASM_COLSOLID`, `ASM_WALKOK` and `ASM_TOUCHATTR` but not `ASM_TILEATTR`. What does the compiler say (look for `Undefined GLOBAL label '.CELL_ATTR'`), and why?

## What you have now

A game you can measure, and the habit of measuring it: an all-BASIC game that was too slow, and a
shipped one that is not, with every step in between measured. Next:
[Chapter 10, The Spectrum build](10-the-spectrum-build.md).
