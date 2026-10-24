# Preparing art for CPCBuild

This page is for drawing sprites, tiles and levels in any paint program so
that `tools/img2cpc.py`, `tools/tmx2bas.py` and Studio's Import Image take
them first time. It covers sizes, layout and colours, not drawing.

If you use Aseprite (tested with 1.3.18.6), install the extension in
`tools/aseprite/` (see its README; in Finder use Open With > Aseprite, or
Aseprite's Preferences > Extensions > Add Extension, since a double-click may
open it in TextEdit): **New CPC Sprite** and **New CPC Tileset** set up everything below,
**Check for CPC** finds the problems, and **Export for CPCBuild** writes the
sheet plus a settings file, so `python3 tools/img2cpc.py hero.png` needs no
options. Everyone else (LibreSprite, Pixelorama, GIMP, Photoshop...) sets the
same things by hand, using the tables here.

Whatever you use, run `img2cpc.py --check` on the PNG before converting: it
prints what would be made, or the problem, and writes nothing.

## 1. The rules every image follows

**PNG, one image pixel = one CPC pixel.** No scaling and no aspect correction.
Indexed or RGB(A) PNGs both work.

**Pixel shape.** CPC pixels are not square. For your editor to show the art as
the CPC will, set its pixel ratio (Aseprite: Sprite > Properties > Pixel
Aspect Ratio; the extension does it for you):

| Mode | Screen | Pens | Pixels per byte | Pixel shape | Pixel ratio |
|---|---|---|---|---|---|
| 0 | 160 x 200 | 16 | 2 | twice as wide as tall | 2:1 |
| 1 | 320 x 200 | 4 | 4 | square | 1:1 |
| 2 | 640 x 200 | 2 | 8 | twice as tall as wide | 1:2 |

**Widths in whole bytes.** A screen byte holds 2, 4 or 8 pixels, so every width
(image, frame or tile) must be a multiple of the mode's pixels per byte.
Heights can be anything.

**Colours.** The CPC has 27 colours, each of red, green and blue being off,
half or full (`0x00`, `0x80`, `0xFF`). Each colour in your image is moved to
the nearest of the 27, so draw with exactly those 27 and nothing moves
(`--check` lists any colour that moved). A mode has 16, 4 or 2 **pens** (the
colours on screen at once). Every image shown together shares one set of
pens; there is no palette per sprite or tile. Changing pens partway down the
screen (rasters) is a program trick, not something an image can carry.

**Transparency.** A pixel is transparent when its alpha is below 128, or when
it is the colour given with `--transparent RRGGBB` (for editors without
alpha, use a colour you don't otherwise use, such as `FF00FF`). Transparent
pixels only mean something in **masked** sprites; anywhere else they become
pen 0.

## 2. One palette for the whole game

Choose the pens once, then give every image the same list:

```sh
# take the pens from one image (in order of first appearance) and save them
python3 tools/img2cpc.py --mode 0 --tiles --write-palette art/game.pal art/tiles.png -o tiles.bas
# every other image uses that list
python3 tools/img2cpc.py --mode 0 --frame 16x16 --masked --palette-file art/game.pal art/hero.png -o hero.bas
```

Or write the list by hand: firmware colour numbers 0-26, comma or space
separated, `#` comments, pen 0 first. With a fixed list each image colour
takes the nearest pen. Without one, pens are given in order of first
appearance (top row first), so two images would number their pens
differently. Pen 0 is the background and what transparent and erased pixels
become in unmasked art.

The Aseprite extension writes the palette into each export's settings file, so
pens stay as you drew them.

## 3. Sprites

A sprite is either the whole image or a **sheet** of equal **frames**:

```
 frame 0 | frame 1 | frame 2 | frame 3
 frame 4 | frame 5 | ...
```

- Frames are cut left to right, then top to bottom (`--frame WxH`, in pixels).
- No gaps, borders or padding between frames; the image must be a whole number
  of frames (`image 50x16 is not a whole number of 16x16 frames`).
- Every cell is a frame: a blank cell at the end is a blank frame.
- Frame width: a multiple of the pixels per byte (2, 4, 8). Widths of 1, 2, 4 or
  8 **bytes** use the library's fast paths (in mode 0: 2, 4, 8 or 16 pixels).
- `--masked` adds a mask byte to every byte, so the sprite can be drawn over a
  background; it costs about 30 % more time. Unmasked sprites cover their whole
  rectangle.

Output: `NAME`, `NAME_W` (bytes), `NAME_H` (lines), `NAME_FRAMES`, `NAME_SIZE`
(bytes per frame). Frame n is at `@NAME(n * NAME_SIZE)`. With the Aseprite
extension, each animation tag also gives `NAME_<TAG>` (first frame) and
`NAME_<TAG>_LEN` (frame count).

## 4. Tiles

A tile set is an image cut into **tiles**, left to right then top to bottom;
tile 0 is the top-left one.

- Tiles are 8 lines tall. Their width is 8 pixels by default, or set with
  `--tile-width` to 1, 2 or 4 bytes, matched by `SetTileWidth` in the program:

| Mode | Tile widths (pixels) | Default |
|---|---|---|
| 0 | 2, 4, 8 | 8 |
| 1 | 4, 8, 16 | 8 |
| 2 | 8, 16, 32 | 8 |

- The image must be a multiple of the tile size.
- At most 256 tiles (tile numbers are one byte).
- Tiles are not masked (`--masked` is for sprites): any transparent pixel in
  a tile becomes pen 0. Editors show it as a checkerboard, the CPC as pen 0's
  colour; `--check` counts them (`transparent pixels: N`).
- `--dedupe` drops repeated tiles and writes a map (`NAME_MAP`, `NAME_MAPW`,
  `NAME_MAPH`): you can draw a whole screen as one picture and get both the
  tile set and the map from it. `--check` says how many repeats there are.
- `DoTile16` draws tiles `4t` to `4t+3` as a 2 x 2 block (top-left, top-right,
  bottom-left, bottom-right), so for 2 x 2 "big tiles" put each block's four
  tiles one after another in the sheet.

## 5. Levels in Tiled

`tmx2bas.py` turns a Tiled map layer into a `TileMap` array.

- New Tileset: "Based on Tileset Image", the same PNG you give `img2cpc.py
  --tiles`, tile width and height the same as the CPC tiles (8 x 8, or e.g.
  4 x 8 with `--tile-width 4`), no margin or spacing.
- New Map: orthogonal, fixed size (infinite maps are not supported), map tile
  size equal to the tileset's.
- Tile number = Tiled's tile ID in that tileset (the gid minus the first
  tileset's firstgid). Empty cells become 0, or `--empty N`.
- Flipped or rotated tiles keep their tile number; the flip is ignored, since
  the CPC has no flipped tiles. Draw flipped versions as tiles of their own.
- Layer format: CSV, or Base64 uncompressed, zlib or gzip (not zstd).
- `--layer NAME` picks the layer (default the first tile layer).

The Aseprite extension can also export a tilemap layer as a `.tmx` that both
`tmx2bas.py` and Tiled open. Aseprite tile index i is CPC tile i, and its empty
tile 0 is a blank tile 0.

## 6. CPC Plus hardware sprites

- Exactly 16 x 16 pixels, or a sheet of 16 x 16 cells.
- Up to 15 colours plus transparent, shared by all 16 hardware sprites.
- Colours are 12-bit: each channel is rounded to 16 levels (`0x11` steps), so
  `0x000000`, `0x111111` ... `0xFFFFFF` are exact.
- `--plus-sprite` (and `--plus-palette` for the colours).

## 7. The same art on the Spectrum

`--spectrum` makes ZX Spectrum data from the same PNG. Width and height must
be multiples of 8, and each 8 x 8 cell gets only two colours (its two most
frequent: paper and ink). Keep two colours per 8 x 8 cell where the art must
look right on both machines.

## 8. Using it in a project

With the Aseprite extension:

1. Export into the project's `assets/` folder (e.g. `assets/hero.png`). Inside a
   project (a `cpcbuild.json` above the folder) Export also writes a recipe,
   `assets/hero.cpcimp`, naming only the image and `assets/hero.bas`; an existing
   recipe is kept. The export summary says which.
2. In `main.bas`: `#include "../assets/hero.bas"` (**CPC Game Studio: Insert Asset Use**
   writes the lines).
3. Build. Every build turns the PNG into `hero.bas` with the settings file's
   mode, frames, palette and tags, so after changing the art (or its settings) in
   Aseprite, export again and build: nothing else to update. `cpcbuild.json`'s
   `"assets"` list (a new project has `assets/**/*.cpcimp`) is what makes the
   build find the recipe; the summary warns if it doesn't match.

Maps are not built automatically: convert `NAME_map.tmx` with **CPC Game Studio:
Convert Tiled Map to BASIC** or `tmx2bas.py` after changing the level.

Without Aseprite: put the PNG in `assets/`, right-click it, **CPC Game Studio: Import
Image**, choose the settings and save; the recipe it writes is built the same
way.

## 9. Checklist

- [ ] Mode chosen; editor pixel ratio set (2:1, 1:1, 1:2).
- [ ] Widths are multiples of 2 / 4 / 8 pixels (mode 0 / 1 / 2).
- [ ] No more than 16 / 4 / 2 colours, drawn with the 27 CPC colours.
- [ ] One palette file shared by all images.
- [ ] Sprite sheets: frames row by row, no gaps, no spare cells.
- [ ] Tiles: a multiple of the tile size, at most 256 after `--dedupe`.
- [ ] Transparent = alpha (or one `--transparent` colour), masked sprites only.
- [ ] `img2cpc.py --check` says `ok`.

## 10. Common errors

| Message | Fix |
|---|---|
| `image width 130 is not a multiple of 4 (mode 1 has 4 pixels per byte)` | Resize the canvas to a multiple of 2 / 4 / 8. |
| `frame width 10 is not a multiple of 4 (mode 1)` | Same, for `--frame`. |
| `image 64x20 is not a whole number of 16x16 frames` | Canvas = columns x frame width by rows x frame height; check `--frame`. |
| `the image needs 10 colours (firmware [...]), mode 1 has only 4 pens` | Reduce colours (colours that are close move to the same CPC colour; very different ones don't), or use mode 0. |
| `palette has 5 pens, mode 1 has 4` | The palette file is for another mode. |
| `tile image size 100x64 must be a multiple of 8` | Canvas a multiple of 8 x 8 (or of the `--tile-width` x 8). |
| `tile width 6 must be 2, 4 or 8 pixels in mode 0 (1, 2 or 4 bytes)` | Pick a width from the table in section 4. |
| `300 tiles; tile numbers go up to 255` | Use `--dedupe`, or split into two tile sets. |
| `--masked applies to sprites only` | Tiles can't be masked; draw the background into the tile. |
| `sprite image 20x16 must be a whole number of 16x16 cells` | Plus sprites are 16 x 16. |
| `hero.cpcbuild.json: ...` | The settings file is wrong; export again, or use `--no-sidecar`. |
