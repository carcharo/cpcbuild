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
reading. Every number in this chapter was measured on a CPC 464 in the repository's headless emulator (built on
the chips emulator), with the compiler of this release, or is labelled with where it came from. Your own numbers will differ a little
(the compiler improves, and a build in the emulator tab is not byte for byte the one the tests make), so measure your own game
before you believe a table.

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
the build report. The report is plain text. For the finished game built with every routine in plain BASIC (`-D LAMP_BASIC`),
whose size is 27,436 bytes, it reads:

```
Build report for cpc464:
  27436 bytes, &0040-&6B6C
    passes &4000 by 11116 bytes (only matters if you use a back screen or banks)
    headroom below &8B60: 8180 bytes  [firmware heap start]
```

(The numbers are worked out from the 27,436 bytes: &0040 + 27,436 = &6B6C, &6B6C - &4000 = 11,116 and
&8B60 - &6B6C = 8,180.) Run
**CPC Game Studio: Show Build Report** to print the last one again. Your own build will be a few hundred bytes
different. The lines mean:

- **`27436 bytes, &0040-&6B6C`**: the program's size and address range. Studio reads the start from the `.map`
  file the compiler writes next to the program (the label `.core.__START_PROGRAM`) and adds the size.
  A CPC program loads at `&0040` by default (library: **Program origin**).
- **`headroom below &8B60`**: the firmware's heap starts at `&8B60`; the program must end below it.
  From `&0040` that leaves about 34.8 KB (library: **Program origin**). The all-BASIC Lamplighter ends at `&6B6C`
  and has **8,180 bytes spare**: room to add rooms. (With the assembly of this chapter it will be 8,461.)
- **`passes &4000 by 11116 bytes`**: a reference line, not an error. A program that
  uses double buffering or the 6128's banks must stay below `&4000` because it reserves `&4000-&7FFF`.
  Lamplighter is single-buffered and keeps no banks, so it passes that line by design, and the line says it only matters if you use a back screen or banks.
  A real limit that is exceeded says `OVER` in capitals. The build still finishes: Studio *reports* the
  limit, it does not stop the build. (The finished game's `build_cpc.sh` does stop, with a message, if the
  program ends above `&8B60`. That is a shell script in the repository, not part of Studio; the tutorial never needs it, and we have not tried it on Windows.)

You can add your own reference lines with the setting `cpcbuild.build.memoryLimits`, for
example `{ "my buffer": "0x7000" }`: each becomes another `headroom below` (or `OVER`) line. (A `bare`
target, chapter 10, gets different reference lines: `bare program loaded by RUN"` at `&A67B` for a disc,
and `bare limit` at `&B800`.)

### Where the bytes went

Some of the 27,155 bytes of the finished game (the all-BASIC one is 281 bytes bigger) are exact, because you saw them
as array sizes in the generated files; the sound is what `-D NOSOUND` takes out; the rest is code (yours and the library's)
and the small tables:

| Part | Bytes |
|---|---|
| Tiles: 16 x 32 | 512 |
| Sprites: 12 frames x 128 | 1,536 |
| Rooms: 12 x 460 | 5,520 |
| Music and effects (27,155 less 22,691 for the same build with `-D NOSOUND`) | 4,464 |
| Everything else: the code, the font, the room objects and names | about 15,100 |

To see for yourself, open `build/<name>.map`. It is a list of `address: label` lines. Sort it by address in
your head: the program's code comes first, the data arrays after. The library's own table
(**Performance tips**, "What each routine adds") says what each routine costs in bytes, so you can add up the
library calls Lamplighter uses (`PutSpriteMasked`, `TileMap`, `TileRestore`, `DoTile8`, `TextFont` and `TextAt`); the rest
is your code and data.

Studio also has views you can use once the emulator is running; this tutorial does not need them, but they
are worth a look. The **CPC Game Studio** icon in the Activity Bar opens three: **Symbols** (the map's labels,
grouped, with their addresses and, for variables, live values), **Registers** (the Z80's registers when the
program is stopped; its toolbar has Pause, Resume, Step, Step Over, Step Out and **Show Memory**) and
**Breakpoints** (a breakpoint is set on a symbol, with an offset). **CPC Game Studio: Show Memory** opens a
read-only hex and ASCII view with a go-to box (an address or a symbol), the bytes that changed marked, and a panel with the
registers and the stack. While a program is stopped the status bar
says `CPC paused at PutSprite` (a symbol and offset); while it runs it says `CPC running`. A watch list and memory writes are not built yet.

## Step 2: Think in frames

The CPC redraws the screen 50 times a second: one **frame** is 20 ms, which is **80,000 T-states**
(the library's unit: every instruction takes a whole number of microseconds, so counts are
"effective" T-states). Lamplighter takes one game step every **2 frames**, 25 steps a second, so a step
has about **160,000 T-states** to read the keys, move everything, draw and make sound.

The firmware's own interrupts take 12 to 23 % of that unless game mode turns them off
(chapter 8; the library's **Frame hook and game mode**). What the calls a step makes cost, measured by calling each from BASIC
many times in game mode (20,000 for the cheap ones, 20 for `TileMap`) and taking away the cost of the empty loop:

| Item | Cost (T-states) |
|---|---|
| `PutSpriteMasked`, one 4 x 16 sprite | about 6,100 |
| `TileRestore` of its old rectangle, not aligned to a tile | about 10,000 |
| one moved sprite: the two calls | about 16,000 |
| `DoTile8`, one tile | about 1,800 |
| `TileMap`, a whole room (460 tiles) | about 528,000, which is 6.6 frames |
| `TextAt`, a five-letter string | about 15,800 |
| a call to a SUB that does nothing | about 120 |
| an array access with a variable index | about 600 |

Five moved sprites (the player and four enemies) cost about 80,000: half the budget, before a line of game logic runs.
That is why chapter 6 moves half the enemies each step, and why the layer redraws only sprites that changed. And
a string is dear: `TextAt` costs as much as a moved sprite, which is why the HUD draws only what changed.

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
INFO steps= 250  frames= 555  per second= 22 . 5  late= 52  longest= 3
```

(The line is printed by the finished game's `main.bas`, with `PRINT`, so the numbers have the text Locomotive BASIC gives
numbers: a space before a positive one and a space after. It is printed in mode 0, 20 columns wide, so on the screen it wraps in the
middle of words: `INFO steps= 250  fra`, `mes= 555  per second`, and so on.
These numbers were measured on a 464 with the repository's headless emulator, with the music playing; the same program in the emulator tab should print
the same line, but check yours and see the note at the end of this step.)
<!-- CHECK (for a session in a live VS Code): (1) the line is printed with PRINT in mode 0, which has 20 columns, so it wraps over several rows; confirm it is readable in the emulator tab and not scrolled away when the program ends. If it is hard to read, the test harness reads the same line from the emulator's console (games/lamplighter/tests/bench.sh). (2) confirm the emulator tab prints the same figures as the headless emulator (555 / 22.5 / 52 for the all-BASIC build, 499 / 25.1 / 16 with all six routines). -->

How to read it:

- **`per second`** is steps divided by time. 25.0 means every step fit in two frames. Yours says **22.5**: the
  all-BASIC game is too slow for a 464.
- **`late`** counts steps that took more than two frames; **`longest`** is the longest one, in frames. A
  game can average 25.0 and still stutter if some steps are late. Yours has 52 late steps out of 250. Add `BENCHLOG` to the defines and
  the first eight late steps are listed with their numbers.

### How much room is left?

The bench *paces* itself: each step waits for two frames. To see how much slack there is, switch the waiting
off. Add `NOPACE` to the target's defines. Now the steps run as fast as they can and the line reports
**frames used for 250 steps** (500 is the budget). Fewer is better. For your game:

```
INFO steps= 250  frames= 553  per second= 22 . 6  late= 50  longest= 3
```

553 frames is more than 500, so **the all-BASIC game cannot hold 25 steps a second on a 464**, however
you pace it: it is 53 frames, about 11 %, over budget. The rest of the chapter gets it under.
Here are the unpaced figures you will reach:

| Build (464, unpaced; frames for 250 steps) | Frames | Headroom |
|---|---|---|
| your game, all in plain BASIC, with music | 553 | none: 11 % over |
| the finished game, with music, all six routines in assembly (`NOPACE`) | 427 | about 15 % |
| the finished game, silent, all six in assembly (`NOPACE` and `NOSOUND`) | 402 | about 20 % |

(Headroom = (500 minus frames) / 500.) Paced, with music and all six routines in assembly, the finished game gets **25.1 steps a second (499 frames, 16 late steps)**; with game mode
switched off (`NOGAMEMODE`) it gets **24.9 (502 frames, 18 late steps)**. So game mode is what
makes the room for music: the library says the same (**Frame hook and game mode**: music and effects
at 25.0 in game mode, 20.0 in normal mode, in the bounce demo). Music itself costs the difference between the second and third row, 25 frames:
about 6 % of a step.

Two more switches are useful for finding where time goes:

| Switch | Meaning |
|---|---|
| `NOPACE` | no frame wait: measure raw speed |
| `NOFLUSH` | no drawing: measure the logic alone |

Run once with `NOPACE`, once with `NOPACE` and `NOFLUSH`: the difference is the cost of drawing. With music, the finished game takes 427 frames with drawing and 192 without, so drawing costs 427 - 192 = 235 frames of the 427: a little over half a step.

## Step 4: Where to look first

You have a game that is 53 frames over budget. Do not guess where. Look at what each hot routine
costs a call, in plain BASIC and in assembly, measured by the same method as the table above, with the cost of an empty call of the same shape taken away
(give or take about 100 T-states):

| Routine | Plain BASIC (T-states) | Assembly (T-states) |
|---|---|---|
| `TileAttr` | 2,270 | 200 |
| `ColSolid` | 7,940 | 900 |
| `WalkOK` | 13,700 | 1,540 |
| `TouchAttr` | 19,000 | 1,690 |
| `CopyRoom` | 434,000 | 11,500 |
| `ScanRoom` | 432,000 | 23,900 |

(A frame is 80,000 T-states, so BASIC `CopyRoom` is about 5.4 frames a call. The calls were `TileAttr(5, 20)`, `ColSolid(7, 100)`,
`WalkOK(56, 152, 1)`, `TouchAttr(2, 3, 100)`, `CopyRoom` of room 9 and `ScanRoom` on room 9.) These six are the routines
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

<!-- fragment: skip: the pattern, with the two versions described in words -->
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
second array access): about 2,270 T-states. In assembly the same steps take 200.

Find `TileAttr` in your `game.bas` (chapter 5) and wrap it, keeping your BASIC version as the `#else` part: put `#ifdef ASM_TILEATTR`
above this listing, then `#else` and your BASIC version below it, then `#endif`. The line `DIM taTab(15)...` stays where it was, above
the `#ifdef`.

<!-- same as games/lamplighter/game.bas -->
```basic
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
  ld de, _cur__a.__DATA__
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
  ld de, _cur__a.__DATA__
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
```

(From `game.bas`.)

What it does, in words, so you can follow the listing:

- `ASM` and `END ASM` mark the assembly inside a CPC BASIC function. The arguments are on the stack
  and an assembly routine reads them itself (library, **Using the library**: assembly routines "read their
  arguments from the stack frame and return in registers"). `ix+5` is `cx`, `ix+7` is `cy`. The answer goes back in `A`.
  The name `_cur__a.__DATA__` is the address of the array `cur`: an array's data has a label made from its name.
- `jp TA_GO` jumps over two things that sit in the middle, because other routines will use them: `TA_TAB`, the
  16-byte attribute table (the same numbers as your `taTab`, now as a `defb` line), and `CELL_ATTR`, a
  small routine that takes a column in `B` and a row in `C` and returns that cell's attributes in `A`.
- `TA_GO` is the same job for the arguments on the stack. Row times 20 is done with shifts and adds, as
  the comments show: `add hl, hl` twice makes row x 4, adding the row back makes x 5, and two more doublings make x 20. Then it adds `cx`
  and the address of `cur`, reads the tile, keeps the low 4 bits (`and 15`) and looks the result up in `TA_TAB`.

Now measure. Add `ASM_TILEATTR` to the `defines` and run the bench, paced and then with `NOPACE`:

```
INFO steps= 250  frames= 499  per second= 25 . 1  late= 14  longest= 3
INFO steps= 250  frames= 450  per second= 27 . 7  late= 1  longest= 3
```

That one routine takes the unpaced run from 553 frames to 450 (103 frames, 19 % less) and the paced run from 22.5 steps
a second with 52 late steps to 25.1 with 14. The game now makes its target. The build is 27,443 bytes, 7
more than all-BASIC.

## Step 6: ColSolid

`ColSolid(c, y)` asks whether column `c` is solid at any of three heights. It calls `TileAttr` three times and
tests the answers. In BASIC that is about 7,940 T-states, almost all of it three calls and the work around them. In assembly it
calls `CELL_ATTR` directly, with no stack frame in between: 900.

`ColSolid`'s assembly uses `CELL_ATTR`, which lives inside `TileAttr`'s assembly. **So turn on
`ASM_TILEATTR` first, and keep it on.** Wrap `ColSolid` the same way:

<!-- same as games/lamplighter/game.bas -->
```basic
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
```

(From `game.bas`.) `ix+5` is `c` and `ix+7` is `y`. For each of the three rows `y`, `y + 8` and `y + 15` it
shifts right three times (the `>> 3` of your BASIC), calls `CELL_ATTR` and tests bit 0, solid. The first solid cell
jumps to `CS_YES`, which answers 1; otherwise it answers with the last test's result.

Add `ASM_COLSOLID` and bench:

```
INFO steps= 250  frames= 499  per second= 25 . 1  late= 14  longest= 3
INFO steps= 250  frames= 445  per second= 28 . 1  late= 2  longest= 3
```

Unpaced: 5 frames faster (450 to 445). Paced: the late steps stay at 14. The program gets 26 bytes smaller (27,417). It is a
small win, and it costs nothing to keep.

## Step 7: WalkOK

`WalkOK(x, y, dir)` is the walkers' test: is the column in front free, no spikes at the feet, ground under it?
It calls `ColSolid` and `TileAttr` twice more. In BASIC: about 13,700 T-states a call, and every walker that moves makes one; in assembly: 1,540.

<!-- same as games/lamplighter/game.bas -->
```basic
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
```

(From `game.bas`.) It is `ColSolid` and then two more `CELL_ATTR` calls (spikes in row `y + 15`, ground at `y + 16`), with a
jump to `WK_NO` on the first thing that says no. Again it needs `ASM_TILEATTR`.

Add `ASM_WALKOK`:

```
INFO steps= 250  frames= 499  per second= 25 . 1  late= 17  longest= 3
INFO steps= 250  frames= 442  per second= 28 . 2  late= 2  longest= 3
```

Another 3 frames unpaced (445 to 442), and the late steps wobble (17). The size drops by 19 bytes (27,398). In
this bench `WalkOK` buys little: it has two walkers, and each moves only every second step.

## Step 8: TouchAttr

`TouchAttr(l, r, y)` runs every step: it is the "is the player on a lamp or on spikes?" test, and the
common answer is "no". In BASIC it is `TouchRow` three times, each a loop of `TileAttr` calls: about 19,000 T-states. In
assembly it is 1,690.

Wrap both `TouchRow` and `TouchAttr` in one pair, with the assembly first and both BASIC functions in the `#else` part:

<!-- same as games/lamplighter/game.bas -->
```basic
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
  ld de, _cur__a.__DATA__
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
```

(From `game.bas`.) `TOUCH_ROW` takes a row in `A` and ORs together the attribute of every cell from `l` to `r` in
that row: it computes the address of the first cell once, then walks along the row with `djnz` (decrement `B` and
loop), looking each tile up in `TA_TAB` (so this one also needs `ASM_TILEATTR`). `TOUCH_GO` calls it for the three rows, keeps
only the lamp bit from the first, and returns the OR masked with 24 (lamp and hazard).

Add `ASM_TOUCHATTR`:

```
INFO steps= 250  frames= 499  per second= 25 . 1  late= 15  longest= 3
INFO steps= 250  frames= 427  per second= 29 . 3  late= 2  longest= 3
```

Unpaced it saves 15 frames (442 to 427), the biggest win after `TileAttr`. The program shrinks by 107 bytes (27,291).

## Step 9: CopyRoom and ScanRoom

These two do not change the bench: with them in assembly the unpaced figure is 426 and then 427, a frame either
way, and the paced figure stays at 499 frames. They matter when you walk through a door. To see it, add a
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

<!-- same as games/lamplighter/game.bas -->
```basic
SUB CopyRoom(src AS UINTEGER)
  ASM
  ld l, (ix+4)
  ld h, (ix+5)            ; src
  ld de, _cur__a.__DATA__
  ld bc, 460              ; ROOM_SIZE
  ldir
  END ASM
END SUB
```

(From `game.bas`: a block copy. `ldir` copies `bc` bytes from the address in `hl` to the one in `de`, here 460 bytes
from the room's address, passed as the argument, to `cur`. The address comes from BASIC because an array used only from
assembly would be dropped by the compiler.)

<!-- same as games/lamplighter/game.bas -->
```basic
SUB ScanRoom()
  ASM
  xor a
  ld (_nLamp), a
  ld (_nDoor), a
  ld hl, _cur__a.__DATA__
  ld bc, 460
  ld de, _lampCell__a.__DATA__
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
  ld hl, _cur__a.__DATA__
  ld bc, 460
  ld de, _doorCell__a.__DATA__
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
  ld bc, _cur__a.__DATA__
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
```

(From `game.bas`. `cpir` searches memory for the byte in `A`, here tile 5, stopping at each match; `SR_STORE`
turns the address into a cell number and stores it in `lampCell`. Then the same for tile 7 and `doorCell`.) The assembly
writes `nLamp` and `nDoor` through their labels `_nLamp` and `_nDoor`; the compiler sees those names in the ASM block and counts the
variables as assigned.

The results, for 20 repetitions (frames):

| Job | Plain BASIC | Assembly |
|---|---|---|
| `LB_COPY`: `CopyRoom` | 124 | 4 |
| `LB_SCAN`: `ScanRoom` | 122 | 7 |
| `LB_LOAD`: `LoadRoom` (copy and scan both in assembly) | 250 | 15 |
| `LB_ENTER`: `EnterRoom`, all six routines in assembly | 420 | 185 |

So loading a room takes about 12 frames (a quarter of a second) in plain BASIC, and less than one frame in
assembly. A whole room change, with the drawing, goes from 21 frames to 9. You would notice 21 frames, well over a third of a second of
nothing, every time you cross a door. The program shrinks by 64 bytes for `CopyRoom` (27,291 to 27,227) and a further 72 for `ScanRoom` (27,155).
The full build now matches the finished game: **27,155 bytes**, `&0040-&6A53`, and the report shows 8,461 bytes of headroom.

## Step 10: Add it up

All six switched on is the shipped game. The ladder you climbed, on a 464 with music, 250 steps of the bench:

| Routine added (cumulative) | Paced: frames, steps/s, late | Unpaced: frames | Program size (bytes) |
|---|---|---|---|
| none: all plain BASIC | 555, 22.5, 52 | 553 | 27,436 |
| `TileAttr` | 499, 25.1, 14 | 450 | 27,443 |
| + `ColSolid` | 499, 25.1, 14 | 445 | 27,417 |
| + `WalkOK` | 499, 25.1, 17 | 442 | 27,398 |
| + `TouchAttr` | 499, 25.1, 15 | 427 | 27,291 |
| + `CopyRoom` | 499, 25.1, 13 | 426 | 27,227 |
| + `ScanRoom` (all six) | 499, 25.1, 16 | 427 | 27,155 |

Read the table the way you would read your own. `TileAttr` is where almost all the time was: one routine
brought the game from too slow to 25 steps a second. `ColSolid` and `WalkOK` take a few frames more off the unpaced run, `TouchAttr`
takes fifteen, and the last two make rooms load without a pause. Notice what did *not* change: the unpaced figure is 426 or 427 for the last
three rows, and the late-step count moves between 13 and 17 without a matching change in anything else, so do not read
much into one or two late steps. The rest of the game is still plain BASIC.

Both builds play the same game. `make test-lamp` (next step) checks that. The finished game's enemies move every second step, half of them on each step (chapter 6's `eTick`),
and only a still player's overlap is redrawn; music costs the rest: from 402 to 427 frames.

> **The lesson.** Measure first, then change one thing. Almost all of this game is plain BASIC; six hot spots
> are in assembly, and the `#ifdef` switch lets you check each difference rather than take it on trust. The library's own advice
> (**Performance tips**): per-call overhead dominates, array indexing costs a few hundred T-states,
> gate (firmware) calls cost about 220 T-states more than the routine.

## Step 11: Tests (if you have the repository)

The finished game is tested, and the same kind of checks run for the Plus build. **None of this is
part of Studio**: the tests, the goldens and the size checks are scripts and Makefile targets in the
cpcbuild repository, and you run them from a terminal there. They are written for a Unix shell and `make`:
they run on macOS and Linux, and we have not tried them on Windows. If you are on Windows, the Studio steps
above (Build and Run with the `bench464` target) give you the numbers in this chapter without them.

```
make test-lamp        # logic checks and the whole-tower playthrough on the 464 and 6128 builds (again with LAMP_BASIC on the 464), and screenshot goldens, two of them with LAMP_BASIC (45 tests in the latest run)
make reach-lamp       # about a minute: every lamp reachable, the tower finishable (1,085 steps), and enemy patrols clear of doors, exits and entries
games/lamplighter/tests/bench.sh      # the benchmark, headless
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
   at about 2,270 T-states a call, and 80,000 to a frame, how many frames? Then do the same with the
   assembly `TileAttr` (200 T-states, net of the call overhead). The loop and the call add
   their own cost, so expect more than the net figures. Were your predictions close?
3. Add `NOGAMEMODE` to the defines. How many frames, paced and unpaced?
4. Add `NOSOUND`, then `NOMUSIC`, then `NOSFX`. Which part of the sound costs the most time? The most bytes?
5. Add a memory limit line in settings (`cpcbuild.build.memoryLimits`) at `0x6000` and read the report.
6. Open the `.map`: what is the biggest thing in your program that is not code?
7. Turn on `ASM_COLSOLID`, `ASM_WALKOK` and `ASM_TOUCHATTR` but not `ASM_TILEATTR`. What does the compiler say (look for `Undefined label '.CELL_ATTR'`), and why?

## What you have now

A game you can measure, and the habit of measuring it: an all-BASIC game that was too slow, and a
shipped one that is not, with every step in between measured. Next:
[Chapter 10, The 6128 and the Plus](10-6128-and-plus.md).
