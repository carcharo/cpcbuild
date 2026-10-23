# Chapter 2: Palette and tiles

**Goal.** Give the game its 16 colours and its 16 background tiles, and draw one room on the screen
with a single library call.

**What you'll learn**

- How the CPC's palette works in mode 0: 27 colours, 16 pens.
- How to bring a PNG into your program with Studio's **Import Image** and a `.cpcimp` recipe.
- How to do the same job by drawing in Studio's palette and tile editors instead.
- What a tile is, what a tile map is, and how `TileMap` draws one.

**Time:** about 30 minutes.

**Before you start.** You have the project from [chapter 1](01-new-project.md), flattened as step 5 there
describes, with the `cpc464` target selected. Copy these files from `games/lamplighter/assets/` into your
project's `assets/` folder:

| File | What it is |
|---|---|
| `lamp.cpcpal` | the 16 pens, as a text file the palette editor opens |
| `tiles.png` | the 16 tiles, 128 x 8 pixels |

(The finished game's art, palette and map were drawn by a Python script, `assets/make_art.py`. That
script stays outside Studio: the tutorial hands you its finished files.)

---

## Step 1: Meet the palette

The CPC has 27 colours but a screen mode only shows a few of them at once. In **mode 0** (160 x 200
pixels) you get **16 pens**, numbered 0 to 15. Every pixel on the screen is a pen number; a pen is
"whatever colour you currently assigned to it". Change a pen's colour and everything drawn in that
pen changes at once.

You assign colours with the **firmware colour numbers**, 0 to 26: the same numbers as Locomotive
BASIC's `INK` command (not the Gate Array's hardware codes). The library's table is in
`docs/library.md`, section **Data formats**, subsection **Palette**.

Lamplighter's 16 pens are in `lamp.cpcpal`:

```
# Lamplighter's 16 pens (firmware colours)
0,1,3,6,15,24,12,26,13,11,20,9,18,16,5,2
```

That is "pen 0 = colour 0, pen 1 = colour 1, pen 2 = colour 3, ..." In words:

| Pen | Colour | | Pen | Colour |
|---|---|---|---|---|
| 0 | 0 black | | 8 | 13 white |
| 1 | 1 blue | | 9 | 11 sky blue |
| 2 | 3 red | | 10 | 20 bright cyan |
| 3 | 6 bright red | | 11 | 9 green |
| 4 | 15 orange | | 12 | 18 bright green |
| 5 | 24 bright yellow | | 13 | 16 pink |
| 6 | 12 yellow | | 14 | 5 mauve |
| 7 | 26 bright white | | 15 | 2 bright blue |

(From `assets/make_art.py:48`; the names are those of the library's palette table.)

Pen 0 is black: the background of every room.

## Step 2: Open the palette in the palette editor

In the Explorer, double-click `assets/lamp.cpcpal`. It opens in the **CPCBuild Palette Editor** instead of
as text (the editor is the default for `.cpcpal` and `.cpcpal12` files; the tab's title bar has **Reopen as
Text** if you want the raw file).

You should see:

- A toolbar with **Mode 0**, **Mode 1** and **Mode 2** (three choices, set to Mode 0 here: 16 pens),
  undo and redo, **Reset**, **Load from PNG** and a **Copy as** menu.
- **Pens**: a strip of 16 swatches, `P0` to `P15`. Each shows the pen's firmware colour number and name
  (`P5`, `24`, `bright yellow`).
- **Firmware colours (pick one for pen 0)**: the 27 colours as a grid, each with its number and name.
- A side panel with **Colour details** (colour, RGB, how many pens use it), an optional **Border colour**,
  and **Copy as**.

Click a pen in the strip, then a colour in the grid, and that pen takes the colour. Try it on pen 5
(bright yellow, the lamp's glow). Make it something else, and look at the colour swatch. **Undo**
(`Ctrl+Z`) puts it back, and so does **Reset** ("Reset to the last loaded palette"). Do not save a change you
do not want: the game's art assumes these exact pens.

Open the **Copy as** menu (or the **Copy as** panel on the right). It offers the palette as:

- a **Boriel DIM + SetPalette** snippet,
- a **Bare list (--palette)** like `0,1,3,6,...` (that is what `lamp.cpcpal` holds),
- or **SetInk lines**.

You do not need any of them now: the importer in the next step writes the palette array for you. But
the first one is the same shape the program ends up with:

```basic
DIM pal(15) AS UBYTE => {0, 1, 3, 6, 15, 24, 12, 26, 13, 11, 20, 9, 18, 16, 5, 2}
SetPalette(@pal(0), 16)
```

**Drawing your own palette instead.** Run **CPCBuild: New Palette**. It asks one question, **Firmware
palette** (`.cpcpal`: pens as firmware colours 0 to 26, modes 0, 1 and 2) or **Plus palette** (`.cpcpal12`:
12-bit colours, chapter 11), then a Save dialog for the file name. The mode is not asked: you choose it
with the toolbar in the editor. A `.cpcpal` file is just a list of 0 to 26 numbers, one per pen.

## Step 3: Bring the tiles in with Import Image

A **tile** is an 8 x 8 pixel picture. A game board made of tiles is cheap to store and fast to draw.
Lamplighter has 16 tiles, numbered 0 to 15, drawn in one PNG, `tiles.png`: 128 x 8 pixels, 16 tiles
side by side. (One PNG pixel is one CPC pixel: no scaling. For drawing your own, the
[art guide](../art-guide.md) has the sizes, layout and colour rules.)

| # | Tile | | # | Tile |
|---|---|---|---|---|
| 0 | background (black, a few stars) | | 8 | open door |
| 1 | brick | | 9 | heart (the HUD's lives) |
| 2 | platform (a stone ledge) | | 10 | window |
| 3 | ladder | | 11 | wall (dim bricks) |
| 4 | spikes | | 12 | ladder top |
| 5 | lamp, unlit | | 13-15 | unused |
| 6 | lamp, lit | | | |
| 7 | door, closed | | | |

(From `assets/make_art.py:67`.) We will give each tile a meaning in chapter 5.

Now convert the PNG into data your program can include.

1. Run **CPCBuild: Import Image** and choose `assets/tiles.png`. (You can also right-click the PNG in
   the Explorer: the entry is there because your folder has a `cpcbuild.json`.)
2. Studio creates `assets/tiles.cpcimp`, a small file called a **recipe** (an `img2cpc.py`
   command line, as JSON), and opens it in the **CPCBuild Image Importer**. A new recipe starts with
   Mode 1 and Sprite, so you will change those. It already points its output at `assets/tiles.bas`
   (beside the recipe).
3. The options are in the left column, in sections (in a narrow window the editor has tabs instead:
   **Options**, **Preview**, **Mapping**, **Command**). Set:

| Section | Option | Value |
|---|---|---|
| Target | (the four buttons) | **CPC** |
| Target | mode buttons | **Mode 0** |
| Target | Name | `tiles` (the default: the image's file name) |
| Target | Output file | `assets/tiles.bas` |
| Sprites and tiles | (two buttons) | **Tiles** (not Sprite) |
| Colours | Palette: Automatic / Pens / File | **File** |
| Colours | Palette file (.cpcpal) | `assets/lamp.cpcpal` (type it, or **Browse...**) |
| Colours | Emit the palette (NAME_pal, NAME_PENS) | ticked |

   Under each option the editor prints the `img2cpc.py` flag it sets (`--mode 0`, `--tiles`,
   `--palette-file F`...).
4. Look at the **Command** line across the top of the editor (under the **Command** tab in a narrow
   window, where it is headed **Equivalent command**). It should read like this:

```
python3 tools/img2cpc.py --mode 0 --name tiles --tiles --palette-file assets/lamp.cpcpal assets/tiles.png -o assets/tiles.bas
```

   That is the very command the finished game's `build_assets.sh` runs for these tiles. The editor
   never hides the command line, so you always know what the tool is doing. **Copy** puts it on the
   clipboard.
5. **Save** (`Ctrl+S`). Studio writes `assets/tiles.bas`, because the setting
   `cpcbuild.assets.generateOnSave` is on by default. (The **Generate** button at the top right does
   the same without saving; a line under the header says when the output is missing or out of date.)
   If Studio is in Restricted Mode (chapter 1) nothing is written: trust the workspace first.

The importer's pen mapping is strict: with a fixed palette every PNG pixel takes the nearest pen
(by RGB distance), ties going to the lower pen. `make_art.py` drew the PNG with the exact RGB of
each firmware colour, so the mapping is exact. If you ever see an error like "the image needs 5
colours, mode 1 has only 4 pens", the picture uses more colours than the palette has pens.

**The same recipe as text.** If you prefer, create `assets/tiles.cpcimp` yourself, with this
content, and run **CPCBuild: Regenerate Assets**:

```json
{
  "format": "cpcimp",
  "version": 1,
  "source": "assets/tiles.png",
  "output": "assets/tiles.bas",
  "target": "cpc",
  "mode": 0,
  "name": "tiles",
  "kind": "tiles",
  "palette": { "file": "assets/lamp.cpcpal" },
  "emitPalette": true
}
```

This is exactly the finished game's `games/lamplighter/assets/tiles.cpcimp`.

Open `assets/tiles.bas`. It starts with a comment saying where it came from and not to edit it:

```basic
' Generated by img2cpc.py --mode 0 --name tiles --tiles --palette-file assets/lamp.cpcpal assets/tiles.png -o assets/tiles.bas
' Source: assets/tiles.png, 128x8 pixels, mode 0
' 16 tiles of 32 bytes
' Do not edit; regenerate it from the source image (command above).

DIM tiles(511) AS UBYTE => { _
    $00, $00, $00, $00, $00, $00, $40, $00, $00, $00, $00, $00, $40, $00, $00, $00, _
    ...
```

(Header from `games/lamplighter/assets/tiles.bas:1-4`; the tool writes the same text whichever way you
generated the file, including the "regenerate it from the source image" line.) At the end are `tiles_COUNT` (16) and
`DIM tiles_pal(15)` with `tiles_PENS` (16): the palette, written with the tiles because we asked for
**Emit the palette**. Never edit a generated file; change the PNG or the recipe and generate again.

Why 32 bytes a tile? In mode 0 one screen byte is **2 pixels**, so an 8-pixel-wide tile row is
4 bytes, and a tile is 8 rows of 4 bytes. Mode 1 would be 16 bytes a tile, mode 2 eight (library:
**Data formats**, "Tile and tile set").

### The other way: draw the tiles yourself

You do not have to import. Run **CPCBuild: New Tileset**, choose **Mode 0** from the quick-pick, and give
the file a name such as `assets/mytiles.cpctil` in the Save dialog. The **CPCBuild Tile Editor** opens with
one empty tile.

- **Pick the palette.** In the **Palette** section of the right-hand panel, change the drop-down from
  **This document** to **Shared file...** and choose `assets/lamp.cpcpal`. The pens strip at the bottom now
  shows Lamplighter's 16 pens, and the palette file is edited in the palette editor (the file name under
  the drop-down opens it).
- **Draw.** Click a pen at the bottom for your left mouse button (badge **L**) and another for the right
  button (**R**), then draw with the pencil (`B`). The other tools, along the top row: line `L`, rectangle
  `R`, ellipse `E`, flood fill `F`, replace colour `K`, picker `I` and select `S`. `Ctrl+Z` undoes. The
  toolbar also has **Filled**, mirror **X** and **Y**, flip **H** and **V**, and **Shift**.
- **Neighbours.** The editor shows your tile with its neighbours dimmed around it, so you can match
  edges. The **8x8** and **16x16** buttons change the view.
- **Add a tile.** The strip on the left lists the tiles; its **Add tile** button (the `+`, key `N`) appends
  one, and **Duplicate tile** and **Delete tile** sit beside it. The **Tile set** panel has **Show tile
  numbers**, and **Drop duplicate tiles** (the `--dedupe` option: it would change the numbering, so leave
  it off for Lamplighter).
- **Status line.** At the bottom: `x 3, y 5`, `byte 1`, `pen 2 = ...`, `tile 0 of 6`, `8x8 px = 4 bytes
  wide`, `32 B/tile`: the pixel under the mouse, the screen byte it lives in, its pen, and the sizes.
- **Output.** In the **Output** section set **Output file** to `assets/mytiles.bas` (a path relative to the
  document). Save, or press **Generate** (in the title bar, or in that section): the file writes the same
  arrays the importer writes. **CPCBuild: Insert Asset Use**, a button in the editor's title bar, writes the
  `#include` line and a starter call into the code editor that is open.

If you have a PNG but want to touch it up, open the **...** menu in the toolbar: **Import PNG into this
tile...** quantises a PNG into the selected tile with the document's palette (if several colours of the
image land on one pen, it says so), and **Export the sheet as PNG...** writes the whole sheet out.

## Step 4: Draw a room

A **room** is 20 x 23 tiles: the CPC's mode-0 screen is 20 x 25 cells of 8 x 8 pixels, and the bottom
two rows are kept for the HUD. A **tile map** is simply one byte per cell: the tile number, row by
row (library: **Data formats**, "Tile map").

First, the platform layer. Replace `platform_cpc.bas` with:

```basic
' platform_cpc.bas -- the CPC side: screen, palette, tiles (mode 0).
#include <cpc.bas>
#include <cpcbuild.bas>
#include "assets/tiles.bas"

SUB PlatInit()
  Mode 0
  SetPalette(@tiles_pal(0), tiles_PENS)
  SetBorder 0
  ScreenInit()
  ClearScreen(0)                  ' Mode clears to the default paper pen, not our pen 0
  SetTileSet(@tiles(0))
END SUB

' Draws a room: 20 x 23 tile numbers at addr, from the top left of the screen.
SUB PlatRoom(addr AS UINTEGER)
  TileMap(addr, 0, 0, 20, 23)
END SUB

SUB PlatWait()
  WaitRetrace(1)
END SUB

FUNCTION PlatQuit() AS UBYTE
  ScanKeys()
  RETURN KeyDown(KEY_ESC)
END FUNCTION
```

(Simplified from `platform_cpc.bas:110-145`; the real `PlatInit` also sets up text and sprites.)

Then `game.bas`. For this chapter the room is built in code, so you can see exactly which cells
get which tile. Chapter 3 replaces this with the real map.

```basic
' game.bas -- the game logic: no drawing, only calls into the platform layer.

CONST ROOM_W AS UBYTE = 20
CONST ROOM_H AS UBYTE = 23

DIM room(459) AS UBYTE            ' 20 x 23 tile numbers, row by row

SUB SetCell(c AS UBYTE, r AS UBYTE, t AS UBYTE)
  room(CAST(UINTEGER, r) * ROOM_W + c) = t
END SUB

SUB BuildRoom()
  DIM i AS UINTEGER
  DIM c, r AS UBYTE
  FOR i = 0 TO 459
    room(i) = 0                                  ' tile 0: the starry background
  NEXT i
  FOR c = 0 TO 19
    SetCell(c, 0, 1)                             ' tile 1: brick, ceiling ...
    SetCell(c, 22, 1)                            ' ... and floor
  NEXT c
  FOR r = 0 TO 22
    SetCell(0, r, 1)                             ' walls
    SetCell(19, r, 1)
  NEXT r
  FOR c = 4 TO 12
    SetCell(c, 16, 2)                            ' tile 2: a stone ledge
  NEXT c
  SetCell(14, 16, 12)                            ' tile 12: ladder top
  FOR r = 17 TO 21
    SetCell(14, r, 3)                            ' tile 3: ladder
  NEXT r
  SetCell(8, 15, 5)                              ' tile 5: an unlit lamp
  SetCell(9, 5, 10)                              ' tile 10: a window
  FOR c = 5 TO 7
    SetCell(c, 21, 4)                            ' tile 4: spikes
  NEXT c
END SUB

PlatInit()
BuildRoom()
PlatRoom(@room(0))

DO
  PlatWait()
LOOP UNTIL PlatQuit()
```

Two things to notice. First, `CAST(UINTEGER, r) * ROOM_W + c`: the index goes up to 459, which does
not fit in a `UBYTE`, so the row is widened first. If you wrote `r * ROOM_W + c` with both as `UBYTE`
the product would wrap at 255 and the room would be garbage. Second, `ROOM_W` and `ROOM_H` are
`CONST`s: they cost nothing at run time.

`main.bas` is unchanged (it still includes `platform_cpc.bas` and then `game.bas`).

## Build and run

Run **CPCBuild: Build and Run** with the `cpc464` target. In the emulator tab you should see mode-0
graphics: a brick border all round, a stone ledge across the left-centre, an orange ladder up to a
small ledge near the right, a lamp sitting on the ledge, a window high up, and a row of cyan spikes
on the floor. The strip below the room is black. `ESC` quits.

Compare with the real thing: the first room of the finished game is the picture in the
[README](README.md#the-game). If the strip under your room is yellow or another colour, your
`ClearScreen(0)` is missing. If the colours are wrong, check `SetPalette` ran before the tiles were drawn.

## How it works

**`Mode 0`** switches the screen mode and clears the screen. It clears to the *default paper pen*,
which is not our pen 0 (that is why the game calls `ClearScreen(0)` next: it fills the screen with pen
0). See `docs/library.md`, **Screen basics**. **`ScreenInit()`** tells the cpcbuild routines where the
screen is; call it after every `Mode` (**Display**).

**`SetPalette(colours, count)`** gives pens 0 to `count - 1` the firmware colours found at
`colours` (**Palette**). It goes through the firmware *and* the Gate Array so the colours stick.
The library's note is worth remembering: always set colours through the library's calls, never by
writing to the Gate Array yourself, or the firmware's interrupt handler will quietly undo them
within about a fifth of a second.

**`SetTileSet(addr)`** says where the tile pictures are. **`TileMap(map, x, y, w, h)`** draws a `w` x `h`
block of tiles whose numbers are the bytes at `map`, with its top left at cell (x, y). It does not
call the firmware (**Tiles**). In mode 0 it costs about 1,200 T-states per tile for a full screen
(library figure), so a room of 460 tiles takes about 550,000 T-states, a bit under seven frames.
That is fine once per room, and far too slow to do every frame. It is why the game draws sprites
without redrawing the room (chapter 4).

**`WaitRetrace(1)`** waits for the next frame flyback, so a loop around it runs at most 50 times a
second (**Display**).

**`ScanKeys()`** reads the whole keyboard into a buffer; **`KeyDown(KEY_ESC)`** tests one key from it
(**Keyboard**).

## Try this

1. Change the `ROOM`: add a second ledge, a second lamp, a second window. Which tile numbers do
   you use?
2. Open `lamp.cpcpal` in the palette editor, change pen 7 (the white of the ledge's top row) to
   another colour, save, and build again. Do you need to run the importer again? (The tiles store pen
   *numbers*, not colours, but the generated `tiles.bas` also contains a copy of the palette.) Look in
   the **CPCBuild** channel: the palette file is one of the inputs of the recipe, so when it is newer than
   `tiles.bas` Studio regenerates the file before it compiles and prints `Regenerated 1 asset recipe.`
   (Put the pen back afterwards, and build again.)
3. Draw a tile 13 of your own in the tile editor (a gravestone? a crate?), import or generate, and
   put it in the room.
4. In `PlatInit` change `SetBorder 0` to `SetBorder 26`. Which colour is the border?
5. Replace `TileMap` with a loop of `DoTile8(cx, cy, tile)` calls for the first row of the room.
   Time the difference: that is a call per tile from BASIC instead of one call for 460.

## What you have now

A mode-0 screen with a palette and a tile set, and the first room. Next:
[Chapter 3, The tower](03-the-tower.md).
