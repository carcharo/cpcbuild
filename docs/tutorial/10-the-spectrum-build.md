# Chapter 10: The Spectrum build

**Goal.** Build the same game for the ZX Spectrum 48K and 128K, without changing a line of `game.bas` or
`main.bas`, and see exactly what the platform layer has to supply.

**What you'll learn**

- How the CPC game's calls map onto a very different machine.
- How one source picture becomes CPC data and Spectrum data (`--spectrum` imports).
- The `cpcbuild.json` settings a Spectrum target needs.
- What is different on the Spectrum, and why the game still holds 25 steps a second.

**Time:** about 40 minutes. You do not need a Spectrum: any Spectrum emulator that loads `.tap` files will do.

**Before you start.** Chapter 8 is working (the sound chapter: the Spectrum build uses the same four
sound calls). Copy these files from `games/lamplighter/` into your project, keeping the same folders:

| From | To |
|---|---|
| `assets/zx/zx_tiles.png`, `assets/zx/zx_sprites.png` | `assets/zx/` |
| `assets/zx/sfx_zx.bas` | `assets/zx/` |
| `platform_zx.bas` | the project root (replace the template's) |

(The two PNGs are drawn by the same `make_art.py` script as the CPC art, which stays outside Studio.)

Most of this chapter is *reading* `platform_zx.bas`, which is 1,035 lines, a third of it assembly. You
will not type it. You will see why it is written the way it is.

---

## Step 1: What is different about the Spectrum

| | Amstrad CPC (mode 0) | ZX Spectrum |
|---|---|---|
| Screen | 160 x 200, 16 pens, any pixel any pen | 256 x 192, one bit per pixel, plus **one colour attribute per 8 x 8 cell** (ink, paper, bright) |
| Tiles | 32 bytes, 4 bytes wide | 8 bytes of bitmap plus 1 attribute byte per cell |
| Sprites | masked, pen colours | ink-only silhouettes drawn by OR; the colour comes from the cell's attribute |
| Memory | a program loads at `&0040` | a program loads at 32768 (`ORG`) |
| Sound | AY chip on every CPC | 48K: a beeper; 128K: an AY chip |

Lamplighter's rooms are 160 x 184 pixels. On the CPC that is the whole width of a mode-0 screen. On
the Spectrum it is the middle of the screen: **character columns 6 to 25 of 32**, rows 0 to 22, with row 23 for the
HUD across the whole width (`platform_zx.bas:16-26`). A logical x of 0 to 159 is a pixel across, plus 48.

The Spectrum can only have one ink and one paper per 8 x 8 cell, so a lit lamp, which uses several colours on the
CPC, is drawn all yellow, and the window's panes blue. That is a design decision in the art:
`make_art.py` writes a Spectrum picture of each tile with exactly the colours the Spectrum can keep
(`ZX_TILE_CHARS`), from the same drawing.

## Step 2: Spectrum art from the same source

You copied two PNGs, `zx_tiles.png` (the 16 tiles in Spectrum colours) and `zx_sprites.png` (the 12 frames as white
silhouettes on transparent). Import each with **CPCBuild: Import Image**, as in chapters 2 and 4, but choose
the **Spectrum** target. The recipes:

`assets/zx/zx_tiles.cpcimp`:

```json
{
  "format": "cpcimp",
  "version": 1,
  "source": "assets/zx/zx_tiles.png",
  "output": "assets/zx/zx_tiles.bas",
  "target": "spectrum",
  "name": "zx_tiles"
}
```

`assets/zx/zx_sprites.cpcimp`:

```json
{
  "format": "cpcimp",
  "version": 1,
  "source": "assets/zx/zx_sprites.png",
  "output": "assets/zx/zx_sprites.bas",
  "target": "spectrum",
  "name": "zx_sprites",
  "zxSprite": true
}
```

These are the finished game's two commands (`build_assets.sh`):

```
python3 tools/img2cpc.py --spectrum --name zx_tiles assets/zx/zx_tiles.png -o assets/zx/zx_tiles.bas
python3 tools/img2cpc.py --spectrum --zx-sprite --name zx_sprites assets/zx/zx_sprites.png -o assets/zx/zx_sprites.bas
```

(In the importer, choose the **Spectrum** target button; the second recipe also ticks **Sprite data (one
bit per opaque non-black pixel)**, which is `--zx-sprite`. The **Command** line at the top of the editor
shows the command above.)

Save each recipe, and Studio generates the `.bas` files. The Spectrum import runs on Studio's built-in
engine like the others: you do not need Python for it (`cpcbuild.assets.engine` is `builtin` by default;
the `python` engine would also need Pillow). For the tiles the tool picks an ink and a paper per cell from the
colours it finds there and writes `zx_tiles` (8 bytes per cell) and `zx_tiles_attr` (one attribute byte per cell). For the
sprites, `--zx-sprite` keeps only the shape (ink only), because the game sets the colour itself.

Note the same recipe for the CPC and the Spectrum gives *different data from the same drawing*: that is
the point of a pipeline from art to code. Your game logic never sees either.

## Step 3: Read the Spectrum layer

Open `platform_zx.bas`. The first 50 lines are a plain-English comment explaining the design. Then
read down to `PlatInit`. The layer implements the same calls as `platform_cpc.bas`, with the same meaning:

| Call (what `game.bas` and `main.bas` use) | On the CPC | On the Spectrum |
|---|---|---|
| `PlatInit()` | `Mode 0`, palette, tiles | `BORDER`/`PAPER`/`INK`, `SpritesInit(0)`, loads the sprite images |
| `PlatRoom(addr)` | blank pens, `TileMap`, pens back | `PzRoom` in assembly: cells go dark first, so the new room appears at once |
| `PlatTile(cx, cy, tile)` | `DoTile8` | `PzTile` (plus sprites erased first) |
| `PlatSprite(slot, frame, x, y)` | notes the wish | notes the wish, in assembly |
| `PlatFrameEnd()` | wait 2 frames, erase and redraw | wait 2 frames (`HALT`), then `PlatFlush` |
| `PlatHud(...)` | `TextAt`, `DoTile8` hearts | `PRINT AT` with `INK`, `BRIGHT` |
| `PlatInput()` | `ScanKeys` and `KeyDown` | `IN(port)` reads |
| `PlatMusic`, `PlatSfx` | Arkos player | 128K: the same player; 48K: beeper effects, no music |

The game cannot tell the difference. Three pieces are worth reading.

**Input.** The Spectrum has no keyboard matrix call; you read ports. `PlatInput` returns the same bits as the CPC's:

```basic
k = IN(57342)                       ' &DFFE: P = bit 0, O = bit 1
IF (k BAND 2) = 0 THEN r = r BOR 1
IF (k BAND 1) = 0 THEN r = r BOR 2
IF (IN(32766) BAND 1) = 0 THEN r = r BOR 4      ' &7FFE: Space
```

(`platform_zx.bas:819-822`.) A pressed key reads as 0, so the test is `= 0`. The keys are the same `O P Q A Space`
as the CPC; a Kempston joystick works too (`-D KEMPSTON` forces it on, `-D NOJOY` off).

**Pacing.** `PlatFrameEnd` does the same job as on the CPC, waiting until two frames have passed, using the
Spectrum's frame counter at address 23672:

```basic
DO
  ASM
  ei
  halt
  END ASM
LOOP UNTIL PEEK(UINTEGER, 23672) - pzLast >= 2
```

(`platform_zx.bas:850-855`, with the build switch around it removed.) `HALT` stops the processor until the next
frame interrupt, which is the Spectrum's flyback.

**Sprites.** A Spectrum sprite library (`lib/zxbuild/sprites.bas`, documented in the library as **Spectrum
sprites (zxbuild)**) draws pre-shifted OR sprites that save the background under them, in 16 x 8 images.
Lamplighter's sprites are 8 x 16, so each frame is *two* images (a top half and a bottom half), and the sprite moves
in **4-pixel steps drawn every second logic step**, because the library rounds x to a multiple of 4. The
library's own attribute handling would recolour the empty half of each image, so the layer
gives the images no attribute and sets the 8 x 16 cells' colours itself (cyan for the player, magenta
for the ghosts), restoring them from the room's map when the sprite moves on. That is why `PlatSprite`
and `PlatFlush` are assembly: "the BASIC version was 1.6 frames a step (22 steps/s on 48K); the
assembly one costs less than a frame".

## Step 4: Set up the Spectrum targets

The Shared template already has targets `zx128` and `zx48` (chapter 1). The finished game's build script
(`build_zx.sh`) uses these settings, which you must match:

```json
{ "id": "zx128", "arch": "zx48k", "main": "main.bas",
  "defines": ["ZX128"], "org": 32768, "heap": 512, "package": "tap" },
{ "id": "zx48", "arch": "zx48k", "main": "main.bas",
  "defines": ["ZX48"], "org": 32768, "heap": 512, "package": "tap" }
```

Change the template's two Spectrum targets to these (`zx128` had `org` 31744 and `heap` 256; `zx48` had `heap`
256). Three things changed from the template:

- **`org` 32768** on both: the image has to end below `&F000`, where the sprite library keeps its data
  (`#define ZXSPR_BASE 0xF000` in the layer). The finished game's images are: 48K
  32768 to 52666 (8,774 bytes below `&F000`), 128K 32768 to 57376 (4,064 bytes below). `build_zx.sh` checks
  that and stops with a message if you go over. Studio does not check this limit: for a `tap` target its
  "report" is a single line (`zx48.tap: 19992 bytes, origin 32768`), and the number includes the tape's
  loader, about 94 bytes more than the image itself (the finished 48K tape is 19,992 bytes, `build_zx.sh`'s
  image 32768 to 52666 is 19,898). The size-limit check is one of the things that stay outside Studio.
- **`heap` 512**: the HUD makes small strings.
- `ZX48` or `ZX128`: with neither, the layer takes `ZX128`.

The compiler flags Studio builds from these fields are (from `zxbcArgs` in Studio's `project.ts`): `--arch
zx48k -f tap -B -a --org 32768 -H 512 -I <library> -D ZX48`. The finished script `build_zx.sh` runs the same
with `-S 32768`; `-S` and `--org` are two names for the same option (`zxbc --help`). So `org` is `--org`,
`heap` is `-H`, and `-f tap -B -a` makes a tape with a BASIC loader that runs the program.

## Build and run

Select `zx48` (**CPCBuild: Select Target**) and run **CPCBuild: Build**. Then the same for `zx128`. Each produces
`build/zx48.tap` or `build/zx128.tap` (named after the target). Spectrum targets are build-only in Studio (no Spectrum emulator is bundled): load the
tape in a Spectrum emulator of your own, or on a real machine, with `LOAD ""`. 48K targets the 48K model;
`zx128` needs a 128K model for the AY music.

You should see: the title (with `O P Q A OR KEMPSTON` under it), then the game: the same rooms, in
Spectrum colours: red bricks, white ledges, a cyan player, magenta ghosts. The picture is the same on
48K and 128K; the 128K has music and AY effects, the 48K has beeper blips and no music.
<!-- CHECK (for the user's test session): load build/zx48.tap and build/zx128.tap in a Spectrum emulator and compare with the description above. Nothing here was run on a Spectrum emulator by the tutorial's author; the finished game's own tests ran the headless Spectrum builds (66 logic checks, the playthrough, and 17 + 4 screenshot goldens on both models), but the .tap files themselves were not loaded by any test. -->

The sprites flicker a little where the beam catches one: the Spectrum builds are single-buffered too.

## How it works

**Why the game did not change.** `game.bas` talks only to the platform layer (chapter 1's table). It uses
integers, `UBYTE` and `BYTE`, no floating point, no hardware names. `main.bas` only chooses a layer with
`#ifdef __CPC__`. Everything specific to a machine is in the layer, so adding a machine is writing one
file with about a dozen calls. The Plus layer in chapter 11 is another.

**Speed.** On the Spectrum the game holds **25.0 steps a second** on both models in the benchmark (chapter 9's
bench: 250 steps). The unpaced figures (frames for 250 steps, 500 is the budget) are **283 on the
48K and 295 on the 128K**: (the 464 build with music measured 431 in chapter 9; the library's notes say the 128K's
music player costs about 0.2 frame a step). To run the bench for the
Spectrum you need the repository's headless runner: `games/lamplighter/tests/bench.sh` does it for both models.

**Sound.** `lib/music` works on the 128K exactly as on the CPC (the library says: "the same `music.bas` works on
`--arch zx48k`... on the 128K the player runs on the IM2 frame hook") and stubs out on the 48K, where the layer
plays the same four effects on the beeper instead, at most one a step (`sfx_zx.bas`).

## Try this

1. Change the player's colour: find where the layer sets the sprite's attribute and make him green.
2. Edit `zx_tiles.png`'s brick tile to use another colour. Reimport, rebuild. (A cell has one ink and one paper:
   what happens if you use three colours in one tile?)
3. Compare `platform_cpc.bas`'s `PlatInput` with `platform_zx.bas`'s: what does each need that the other does not?
4. Set `NOMUSIC` in the `zx128` target's `defines`: how many bytes smaller is the tape?
5. Add a new platform-layer call to the game (say `PlatFlash()` that flashes the border when a lamp lights) to
   both layers. Do it first in one layer only and see where the compiler stops you.

## What you have now

The same game on two more machines. Next:
[Chapter 11, The 6128 and the Plus](11-6128-and-plus.md) (optional).
