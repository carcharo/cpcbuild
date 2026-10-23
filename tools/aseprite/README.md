# CPCBuild for Aseprite

An Aseprite extension (Lua, Aseprite 1.3) that sets up CPC art in the layout
`tools/img2cpc.py` and `tools/tmx2bas.py` expect, checks it, and exports it.
Tested with Aseprite 1.3.18.6 (and 1.3-beta20) and Tiled 1.11.2.

## Install

```sh
tools/aseprite/build.sh          # writes tools/aseprite/cpcbuild.aseprite-extension
```

Install it from Aseprite: **Edit > Preferences > Extensions > Add Extension** and
pick `cpcbuild.aseprite-extension`, or in Finder right-click it and choose
**Open With > Aseprite** (a double-click may open TextEdit instead). The commands are in a **CPCBuild**
submenu registered in the menu group `file_scripts` (the File > Scripts area; the
menu itself could not be tested in batch mode). The
zip is built, not committed. The extension also adds the palette
**CPC firmware 27**: the 27 firmware colours in firmware-number order
(number = 9*G + 3*R + B, each of R, G, B 0x00/0x80/0xFF).

## Commands

**New CPC Sprite** asks for the mode (0, 1, 2), the frame width (only multiples
of the pixels per byte: 2, 4, 8), the frame height, the number of frames,
masked or not, and a name. It makes an indexed sprite of one frame size with
that many frames, the grid set to the frame size, and the pixel ratio 2:1
(mode 0), 1:1 (mode 1), 1:2 (mode 2). The palette is the mode's pens in pen
order, starting from the firmware's default inks: mode 0
`1,24,20,6,26,0,2,8,10,12,14,16,18,22,11,15` (pens 14 and 15 flash by default on
the CPC; here they are two colours no other pen uses, so every pen is distinct), mode 1 `1,24,20,6`, mode 2 `1,24`.
Edit the palette entries to pick other firmware colours.

- Not masked: palette index = pen, a fresh canvas is filled with pen 0.
- Masked: palette index 0 is transparent and extra; pen p is index p + 1.

**New CPC Tileset** asks for the mode, the tile width (pixels per byte times
1, 2 or 4: 2/4/8 in mode 0, 4/8/16 in mode 1, 8/16/32 in mode 2; default 8),
the map size in tiles (width and height; the default is a full screen: 160, 320
or 640 pixels wide by 200 lines, so mode 0 with width 4 is 40 x 25 and with width
8 is 20 x 25; offered again whenever the mode or tile width changes) and a name.
It makes an indexed sprite whose canvas is the map (width x tile width by height x 8
pixels) with a tilemap layer "Ground" whose tileset grid is tile width x 8, same
pixel ratio and palette rules (no masked option).
Aseprite's tile 0 is its empty tile.

**Check for CPC** reports: more colours than the mode has pens (16/4/2),
colours that are not one of the 27 firmware colours (img2cpc.py would snap them
to the nearest), palette entries used outside the mode's pens, frame width not a
multiple of the pixels per byte, more than 255 bytes wide or lines high, more than
256 tiles, a tileset grid that is not tile width x 8, partly transparent pixels,
flipped tiles, and a pixel ratio that is not the mode's. The off-palette pixels
of the current frame can be selected from the dialog.

**Export for CPCBuild** runs the check (problems are listed; you can export
anyway) and writes next to the file you pick:

- Sprite: `NAME.png`, all frames as a row-major sheet with no padding, trimming
  or borders; transparent pixels have alpha 0. Columns = the largest divisor of
  the frame count that is at most 8 (so every cell is a real frame: 4 frames is
  4 x 1, 10 frames is 5 x 2; a prime above 8 is one row). Tags become
  `"tags"` in the sidecar, frame numbers 0-based and inclusive.
- Tileset: `NAME.png`, the tiles row-major in tileset order, same column rule,
  **including Aseprite's tile 0 as a blank tile**, so Aseprite tile index i is
  CPC tile number i. Optionally `NAME_map.tmx`, a Tiled map (orthogonal, tile width
  x 8, one tileset from `NAME.png` with firstgid 1, one CSV layer named like
  the tilemap layer, gid = tile index + 1; cells without a tile are tile 0). The `_map` keeps the
  map's BASIC array (named after the .tmx file by tmx2bas.py) apart from the tile
  data (named `NAME` by img2cpc.py).
- Both: `NAME.cpcbuild.json`:

```json
{"format": "cpcbuild-image", "version": 1, "kind": "sprite", "mode": 0, "name": "hero",
 "frame": "16x16", "masked": false, "palette": [1, 24, 20, 6, ...],
 "tags": [{"name": "walk", "from": 0, "to": 3}]}
```

  A tileset has `"kind": "tiles"` and `"tileWidth"` (pixels) instead of `frame`,
  `masked` and `tags`. `palette` is the firmware colour of each pen, in pen order.

- Inside a CPCBuild project (a `cpcbuild.json` in that folder or any parent), also
  `NAME.cpcimp`: see "Using it in a project". Never overwritten.

Sprites not made with New ask for their mode (and tile width or masked) the
first time you Check or Export; the answers are stored in the sprite.

## Using the output

```sh
# sprite or tiles: mode, frame size, masked, palette, tile width, name and the
# tags (hero_WALK, hero_WALK_LEN, ...) all come from the sidecar
python3 tools/img2cpc.py hero.png -o hero.bas
python3 tools/img2cpc.py ground.png -o ground.bas

# what it would make, without writing anything
python3 tools/img2cpc.py --check hero.png

# the level drawn in Aseprite
python3 tools/tmx2bas.py ground_map.tmx -o ground_map.bas
```

img2cpc.py reads `NAME.cpcbuild.json` beside `NAME.png`; options on the command
line override it, and `--no-sidecar` ignores it. The `palette` list becomes the pens,
so the pens in the BASIC include are the ones you drew with. Each tag adds
`NAME_<TAG>` (first frame) and `NAME_<TAG>_LEN` (frames). tmx2bas.py needs no options:
firstgid 1 maps Aseprite tile index i to tile number i, and the empty cell (tile 0)
to 0. The TMX also opens in Tiled for further editing.

## Using it in a project

1. Export into the project, usually its `assets/` folder (File > CPCBuild > Export
   for CPCBuild).
2. The export also writes `NAME.cpcimp` beside the PNG (not for the `.tmx`), the
   smallest importer recipe: only the source image and the output `NAME.bas` beside
   it, as paths from the project root.

   ```json
   {
     "format": "cpcimp",
     "version": 1,
     "source": "assets/hero.png",
     "output": "assets/hero.bas",
     "target": "cpc"
   }
   ```

   It has no mode, frame, palette or the like, so every build takes those from
   `NAME.cpcbuild.json`. An existing `NAME.cpcimp` is kept, and the summary says
   so. The summary says "Added to project <name>: <path>"; it warns if none of
   `cpcbuild.json`'s `"assets"` globs (a new project has `assets/**/*.cpcimp`)
   matches the recipe, because the build would not pick it up.
3. `#include` the `NAME.bas` in your program and Build. Re-export from Aseprite and
   Build again: the new PNG and sidecar are picked up.
4. Maps: `NAME_map.tmx` is not built automatically (the build converts only
   `.cpcimp` recipes). Run `python3 tools/tmx2bas.py assets/NAME_map.tmx -o assets/NAME_map.bas`
   or Studio's "Convert Tiled Map to BASIC"; the array is `NAME_map`, the tile data
   `NAME`.

## Files

| File | Purpose |
|---|---|
| `extension/package.json` | manifest: the script and the palette |
| `extension/cpcbuild.lua` | menu commands and dialogs |
| `extension/cpcbuild_core.lua` | the logic (new, check, export), no dialogs |
| `extension/cpc-firmware-27.gpl` | the palette |
| `headless.lua` | runs the core from `aseprite -b --script`, for the tests |
| `build.sh` | zips `extension/` |

Tests: `python3 -m unittest tests.tools.test_aseprite` (skipped without
Aseprite; set `ASEPRITE` for a binary outside `/Applications`).
