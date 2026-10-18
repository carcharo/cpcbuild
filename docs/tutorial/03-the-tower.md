# Chapter 3: The tower

**Goal.** Replace the hand-built room with the real tower: 12 rooms drawn in the Tiled map editor,
inspected in Studio's map viewer, cut into rooms by a small script, and flipped between with two keys.

**What you'll learn**

- How the tower is laid out and how rooms connect.
- How to read and edit a map in Tiled, and what Lamplighter's object layer means.
- How Studio's map viewer and **Convert Tiled Map to BASIC** work, and why Lamplighter needs one extra step.
- How a room is drawn without flicker, and how text goes on the screen.

**Time:** about 40 minutes.

**Before you start.** Chapter 2 is working. Copy these two files from `games/lamplighter/assets/` into
your project's `assets/` folder:

- `tower.tmx`, the map;
- `fontcpc.bas`, the game's font (a ready-made `.bas`: nothing to import).

`tower.tmx` refers to its tileset image as `tiles.png`, so keep it in the same folder as the map
(you copied `tiles.png` to `assets/` in chapter 2). You also need a checkout of the cpcbuild repository
for step 5, which runs one of its scripts.

---

## Step 1: Know the tower

The tower is **12 rooms in a grid, 3 across and 4 up**. Each room is 20 x 23 tiles, the size of the
screen above the HUD. Room numbers count left to right, top to bottom:

```
        column 0          column 1          column 2
row 0   0  THE BELFRY     1  ATTIC STORE    2  CLOCK LOFT
row 1   3  GLASS GALLERY  4  THE ARCHIVE     5  WEST STAIR
row 2   6  OLD LIBRARY    7  TOWER HALL      8  SERVANTS WAY
row 3   9  THE CELLAR     10 COLD STORE      11 BOILER ROOM
```

The lamplighter starts in room 9 and climbs in a snake: **9, 10, 11** (rightwards), up a ladder to
**8, 7, 6** (leftwards), up to **3, 4, 5**, up to **2, 1, 0**. Room 0, the belfry, is the top. Walking
off the left or right edge of a room takes you to its neighbour (if there is one), and climbing off
the top or falling off the bottom takes you to the room above or below. Where there is no
neighbour, the edge is a wall. (The names are the map's own: you will find them in step 3.)

(From `DESIGN.md`, sections 1 and 11; the rules are in `game.bas:413-480`, which you will write in
chapter 5.)

## Step 2: Open the map in Studio's viewer

In the Explorer, right-click `assets/tower.tmx` and choose **Open With...** then **CPCBuild Map
Viewer**. (The viewer is registered as an option, never the default, so a double-click still opens the
file as text, and Tiled still works normally.)

You should see the whole tower as one picture, 60 x 92 tiles, drawn from `tiles.png`. The viewer is
read-only. Its parts:

- **Toolbar.** Zoom out, Zoom in and **Fit**; the overlays **Grid** (`G`), **Tile numbers** (`N`),
  **Object markers** and **Room** (a frame the size of a screen of cells: it starts at 20 x 25, the whole mode-0
  screen, and has presets and two boxes; type 20 x 23 to see one Lamplighter room, the HUD rows left out); and a **Tile colours** menu: **Tiled image**
  (the picture Tiled uses), **CPC preview, mode 0/1/2** (the picture as the CPC will show it), or a
  matching `.cpctil` tile set if there is one.
- **Layer**, **firstgid** and **empty**: which tile layer to show, the gid of tile number 0 (empty means
  the tileset's own first gid) and the tile number written for empty cells. Lamplighter's defaults are
  right.
- **Tileset** and **Cell** panels on the right. Hover over or click a cell (or move with the arrow keys)
  and **Cell (x, y)** shows its Tiled `gid` and the **tile number** the game will see, with **Copy tile
  number** and **Copy DoTile8 call**. Click a tile in the **Tileset** strip, or type a number into
  **Highlight tile number**, and every cell using it lights up: handy for finding all the lamps (tile 5).
  An **Objects** list names every object of the map and where it is.
- **Buttons along the bottom.** **Array name** and **Generate .bas** (step 4), **Insert TileMap call**,
  **Open in Tiled** and **Open as text**.

Two numbers to know. Tiled counts tiles from 1 (`gid`), the game from 0 (tile number): the tile
number is the `gid` minus the tileset's first gid, which is 1 here. And an empty cell becomes tile 0,
the background.

## Step 3: Look at the map in Tiled

Run **CPCBuild: Open in Tiled** (or use the **Open in Tiled** button in the viewer or in the editor's
title bar; the viewer's button is greyed out when Studio cannot find Tiled). It opens `tower.tmx` in the Tiled
application. If Studio cannot find Tiled, set `cpcbuild.tiled.path` to the application. (The Tiled
screens below are from Tiled 1.9 or later, where the old "Type" field is called **Class**; the file itself
still stores it as `type`.)

In Tiled you will find:

- **A tile layer called `tiles`**, 60 x 92 cells of 8 x 8 pixels, using the tileset `tiles`
  (`tiles.png`, 16 tiles). This is the picture of the tower. Pick a tile in the Tilesets panel and
  paint with the stamp brush.
- **An object layer called `objects`.** Each object is a small rectangle, 8 x 16 pixels (the size of
  the player), with a **Class** (stored in the file as `type`) that tells the game what it is:

| Class (`type`) | Custom properties | Meaning |
|---|---|---|
| `start` | none | where the player appears in this room, top left of the sprite. Exactly one per room |
| `enemy` | `kind` (int): 1 walker, 2 floater, 3 bat; `range` (int): how far in cells | an enemy that starts here. At most 4 per room |

- **Map properties**, with one custom property `names`: the 12 room names, comma separated, in room
  order.

<!-- CHECK (Tiled UI wording, from memory not from a running Tiled): in the Tiled you use, select an object and confirm the Properties panel calls the field "Class" and that custom properties are added with the "+" button at the bottom of the panel. The map was saved by Tiled 1.10.2; 1.11.2 is installed on the authoring machine. -->

A worked example. Room 9 starts at cell (1, 20) of its room, which is pixel (8, 160) inside the room.
Room 9 is in column 0 of row 3, so in the big map its pixel position is x = 0 x 160 + 8 = **8** and
y = 3 x 184 + 160 = **712**. Find the object `start` at x = 8, y = 712 in the object layer.
The room's walker is at room cell (17, 20).

Try moving that enemy: select it, change **x** (keep it a multiple of 8), and save the map (`Ctrl+S`).

Some notes for when you edit the map yourself:

- Draw every room's edges deliberately. Where a room has a neighbour on that side, leave the edge open
  (no brick) so the player can walk off; where it has none, close it.
- The 16 tiles have *meanings* defined in the game (chapter 5): the ladder tile must be where you
  want a ladder, a lamp tile is a lamp. Tile 13 to 15 are unused.
- The game gets a room's lamps by scanning the room's tiles for tile 5: there is no lamp object.

## Step 4: Convert the whole map

Studio can turn a tile layer into a Boriel array in one click: with the map viewer (or the `.tmx`
text) active, run **CPCBuild: Convert Tiled Map to BASIC** (it is also a button in the editor's title
bar), or press **Generate .bas** in the viewer. If the map has more than one tile layer the command asks
which one; Lamplighter has one (`tiles`). The output goes beside the map, with the map's file name and
`.bas`, so here `assets/tower.bas`, with the array named after the file (`tower`). A message says
`CPCBuild: wrote assets/tower.bas`, with an **Open** button. (The **Array name** box in the viewer
changes the name.)

Open the file. It holds the whole map as one array, 60 x 92 = 5,520 bytes, one tile number per cell,
row by row, plus its width and height in tiles (`tower_W` and `tower_H`).
This is the tool `tools/tmx2bas.py` (library docs: **Asset pipeline**, "tmx2bas.py: Tiled maps to
tile maps"). A game with one screen-sized map could stop here:

```basic
SetTileSet(@bgtiles(0))
TileMap(@level(0), 0, 0, level_W, level_H)
```

Lamplighter cannot, for three reasons:

1. It needs the map **one room at a time**: a 20-wide array of 23 rows that `TileMap` draws and
   `TileRestore` (chapter 4) can use to repair the background under a sprite.
2. The game changes the room as you play (lamps light up, doors open), so it works on a **copy** of the
   room in RAM.
3. It needs the objects (start cells, enemies) and the room names, which are not tile data at all.

So the finished game uses one more small tool, `split_rooms.py`. You do not need to keep the
converted file; delete `assets/tower.bas`.

## Step 5: Cut the map into rooms

This step is **not a Studio feature**. Splitting the big map into rooms is a small Python script in the
cpcbuild repository, `games/lamplighter/assets/split_rooms.py`; Studio's map tools stop at the one-click
conversion above. The script reads the `.tmx`, uses `tools/tmx2bas.py` to get the tile layer, and writes one
file with everything the game needs. It finds `tmx2bas.py` relative to its own place in the repository, so
run the script from the repository's copy, in your project folder, giving it your project's paths:

```sh
cd /path/to/lamplighter
python3 /path/to/cpcbuild/games/lamplighter/assets/split_rooms.py assets/tower.tmx -o assets/rooms.bas
```

(No Python on your machine, or no checkout? Copy the finished `games/lamplighter/assets/rooms.bas`
instead; it is the output of exactly this command. You will only need to run the script if you edit the
map.)

Open `assets/rooms.bas`. The header comment says how the file is laid out:

```basic
' Generated by split_rooms.py (tower.tmx); do not edit, regenerate with build_assets.sh.
' 12 rooms of 20 x 23 cells; room r at offset 460 * r.

CONST ROOMS_N AS UBYTE = 12
CONST ROOM_W AS UBYTE = 20
CONST ROOM_H AS UBYTE = 23
CONST ROOM_SIZE AS UINTEGER = 460

DIM rooms(5519) AS UBYTE => { _
    $01, $01, $01, ...
```

(`games/lamplighter/assets/rooms.bas:1-10`.) What is in it:

- **`rooms`**: the 12 rooms, 460 bytes each, back to back, row-major from each room's top left cell.
  Room *r* starts at `r * 460`. Room *r* is in column `r MOD 3` and row `r / 3` (rounded down) of the grid.
- **`robj`**: the objects, five bytes each: `[type, a, b, c, d]`, with a zero type ending each room's
  list. Type 1 is a start: `a`, `b` are the cell column and row. Type 2 is an enemy: `a` is the kind,
  `b`, `c` the cell, `d` the range in cells.
- **`roff(r)`**: where room *r*'s object list starts in `robj`.
- **`RoomName(id)`**: a function returning the room's name from the map property.

(From the docstring of `split_rooms.py:11-16`.) The script also stops with a message if a room has
more than four enemies or not exactly one start, so a mistake in Tiled cannot reach the game.

To rebuild the file after editing the map in Tiled: save in Tiled, run the command again, build. Studio's
**Regenerate Assets** and its automatic regeneration before a build know nothing about this file: they
only run `.cpcimp` recipes.

## Step 6: Draw the rooms and flip between them

Now use the rooms. Replace `platform_cpc.bas`:

```basic
' platform_cpc.bas -- the CPC side: screen, palette, tiles, text, keys (mode 0).
#include <cpc.bas>
#include <cpcbuild.bas>
#include "assets/tiles.bas"
#include "assets/fontcpc.bas"

DIM blankPal(15) AS UBYTE            ' sixteen zeros: every pen black

SUB PlatInit()
  Mode 0
  SetPalette(@tiles_pal(0), tiles_PENS)
  SetBorder 0
  ScreenInit()
  ClearScreen(0)
  SetTileSet(@tiles(0))
  TextFont(@font(0), font_FIRST, 7, font_FIRST + font_COUNT - 1)
  TextPen(7, 0)
END SUB

' Draws a room: the screen is blanked (all pens black) while the tiles go
' down, then the palette comes back.
SUB PlatRoom(addr AS UINTEGER)
  SetPalette(@blankPal(0), 16)
  TileMap(addr, 0, 0, 20, 23)
  SetPalette(@tiles_pal(0), 16)
END SUB

SUB PlatText(col AS UBYTE, row AS UBYTE, s AS STRING)
  TextAt(col, row, s)
END SUB

' Bits: 1 left (O, cursor left, joystick), 2 right (P, cursor right), 4 fire
' (Space, joystick fire), 8 any key, 16 up (Q), 32 down (A).
FUNCTION PlatInput() AS UBYTE
  DIM r AS UBYTE
  ScanKeys()
  r = 0
  IF KeyDown(KEY_O) <> 0 OR KeyDown(KEY_LEFT) <> 0 OR KeyDown(JOY_LEFT) <> 0 THEN r = 1
  IF KeyDown(KEY_P) <> 0 OR KeyDown(KEY_RIGHT) <> 0 OR KeyDown(JOY_RIGHT) <> 0 THEN r = r BOR 2
  IF KeyDown(KEY_SPACE) <> 0 OR KeyDown(JOY_FIRE1) <> 0 THEN r = r BOR 4
  IF KeyDown(KEY_Q) <> 0 OR KeyDown(KEY_UP) <> 0 OR KeyDown(JOY_UP) <> 0 THEN r = r BOR 16
  IF KeyDown(KEY_A) <> 0 OR KeyDown(KEY_DOWN) <> 0 OR KeyDown(JOY_DOWN) <> 0 THEN r = r BOR 32
  IF AnyKeyDown() <> 0 THEN r = r BOR 8
  RETURN r
END FUNCTION

SUB PlatWait()
  WaitRetrace(1)
END SUB

FUNCTION PlatQuit() AS UBYTE
  ScanKeys()
  RETURN KeyDown(KEY_ESC)
END FUNCTION
```

(`PlatRoom` and `PlatInit` are simplified from `platform_cpc.bas:110-145`; `PlatInput` is
`platform_cpc.bas:284-295` unchanged.)

And `game.bas`:

```basic
' game.bas -- the game logic: no drawing, only calls into the platform layer.
#include once "assets/rooms.bas"

CONST I_LEFT AS UBYTE = 1
CONST I_RIGHT AS UBYTE = 2

DIM cur(459) AS UBYTE                 ' the current room's tiles
DIM pRoom AS UBYTE

' Copies room id into cur and draws it.
SUB EnterRoom(id AS UBYTE)
  DIM base, i AS UINTEGER
  pRoom = id
  base = CAST(UINTEGER, id) * ROOM_SIZE
  FOR i = 0 TO ROOM_SIZE - 1
    cur(i) = rooms(base + i)
  NEXT i
  PlatRoom(@cur(0))
  PlatText(0, 24, RoomName(id) + "                    ")
END SUB

DIM inp, was AS UBYTE

PlatInit()
EnterRoom(9)
DO
  PlatWait()
  inp = PlatInput() BAND 3
  IF inp <> 0 AND was = 0 THEN                ' a new press only
    IF inp = I_RIGHT THEN
      IF pRoom < ROOMS_N - 1 THEN EnterRoom(pRoom + 1)
    ELSEIF inp = I_LEFT THEN
      IF pRoom > 0 THEN EnterRoom(pRoom - 1)
    END IF
  END IF
  was = inp
LOOP UNTIL PlatQuit()
```

(`EnterRoom` is simplified from `game.bas:274-287`.) `#include once` means "include this file only
the first time": both `game.bas` and, later, `main.bas` ask for `rooms.bas`, and the compiler must
not define its arrays twice.

## Build and run

Run **CPCBuild: Build and Run** (target `cpc464`). The screen shows room 9, **THE CELLAR**, with its
name at the bottom. Click the screen, then press `P`: the screen blanks for a moment and room 10 appears.
`O` goes back. Walk through all twelve. You should recognise the snake: lamps (a small unlit
lantern), ladders, spikes, windows, and doors (orange blocks) on most rooms.
<!-- CHECK: the room name at the bottom of the screen is partly cut off in the headless screenshots of this stage (the capture is 272 lines high); in the real emulator tab check it is fully visible. -->

For comparison, the finished game's room 9 is [this picture](../../games/lamplighter/tests/golden/464/room09.png)
(the golden test image, with the player, HUD and enemy of later chapters).

If the build stops with `Undeclared function "RoomName"` or similar, check that `rooms.bas` is in
`assets/`. If the room is full of wrong tiles, the map and `tiles.png` disagree:
re-run both conversions.

## How it works

**Blanking while drawing.** `PlatRoom` first sets all 16 pens to black from an array of 16 zeros
(`blankPal`), then draws 460 tiles with `TileMap`, then sets the real palette back. While the tiles
go down you see black, not a room being painted tile by tile. `SetPalette` costs one firmware gate
call per pen (**Palette** in the library docs), which is nothing next to the drawing. This is
`game.bas`'s `EnterRoom` calling `PlatRoom` (`DESIGN.md`, section 3).

**The text.** `TextFont(addr, first, rows, last)` gives the library a font: here 7 bytes per
glyph, ASCII 45 (`-`) to 90 (`Z`) (**Text** in the library docs). `TextPen(ink, paper)` sets the pens
(7 is bright white, 0 black). `TextAt(col, row, s)` draws a string at a text cell. Mode 0 has 20
columns and 25 rows of 8 x 8 cells, so row 24, the last, holds the room name. `RoomName(id) + "   "`
pads the name with spaces so a short name wipes a longer one. Strings are slow-ish and need heap
(`TextAt` costs about 2,900 T-states for the copy of the string alone, library figure), so the real
game draws text only when something changes.

**One byte per cell, 460 bytes per room.** Look at `cur(i) = rooms(base + i)`: the room being
played is a copy in RAM. That is what lets chapter 7's `LightLamp` change a lamp to a lit lamp.

## Try this

1. Press `O` in room 0. Nothing happens: why? (Look at the `IF pRoom > 0` test.)
2. In Tiled, paint a brick wall across room 9's middle. Save, run `split_rooms.py`, build.
3. Add a 13th name to the `names` property. What does `split_rooms.py` say?
4. Change `RoomName(id) + "                    "` to just `RoomName(id)`. Step from room 8
   (SERVANTS WAY) to room 9 (THE CELLAR): what is left at the end of the name? That is why the
   padding is there.
5. Delete the `SetPalette(@blankPal(0), 16)` line before the drawing (keep the one after). Flip rooms.
   What do you see while the room is drawn?

## What you have now

All twelve rooms in your program, and a way to switch between them. Next:
[Chapter 4, The player sprite](04-the-player-sprite.md).
