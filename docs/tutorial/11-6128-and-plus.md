# Chapter 11 (optional): The 6128 and the Plus

**Goal.** Two more targets for the CPC family. First the CPC 6128, which turns out to be the same
program as the 464. Then the CPC Plus (6128 Plus and GX4000), where the player and enemies become
**hardware sprites** and the lit lamps' flames flicker through **palette cycling**, for almost no CPU.

**What you'll learn**

- Why the 6128 build is the 464 build, and what its extra memory would and would not buy this game.
- How a platform layer can wrap another one (`platform_plus.bas` wraps `platform_cpc.bas`).
- How to use the Plus's sprite manager and palette cycling from `lib/cpcplus`.
- How to build and run a Plus cartridge.

**Time:** about 20 minutes for the 6128, about 60 for the Plus. Both parts are optional.

---

# Part 1: The 6128

## Step 1: Build it

Select the `cpc6128` target (**CPCBuild: Select Target**) and run **CPCBuild: Build and Run**. The target's
`defines` are `["CPC6128"]` and its `model` is `"6128"`, so the emulator tab starts a 6128.

You should see exactly what you saw on the 464. That is the finding: **`lamp464` and `lamp6128` are the
same 26,749 bytes** (`DESIGN.md`, sections 11 and 12; the build script prints both). `platform_cpc.bas` has a
`CPC464` and a `CPC6128` switch and does not use either: it defaults to `CPC464` when neither is set (line 30
of the finished file), and the two builds make the same pictures. The finished game's tests run both and keep
a screenshot golden per model: all 17 pictures of the 464 are byte-for-byte the 6128's.

The setting `cpcbuild.model` ("Emulated model; when set explicitly it overrides each target's own
model") lets you run any target on another model: try the `cpc464` target on `6128`.

## Step 2: What the 6128's extra RAM is for, and why this game does not use it

The 6128 has 64 KB of extra RAM in four 16 KB banks, which a program pages in at `&4000-&7FFF`. The library
has calls for it: `BankSelect`, `BankCopyIn`, `BankLoad` (load a disc file straight into a bank) and
`MusicInitBank` (play a song from a bank) (library: **Extra RAM banks (6128)**). They would be the way to
keep more levels than fit in memory and load a level from disc when you need it (`DESIGN.md`, section 4,
suggests exactly that as an optional extra).

Lamplighter does not do this, and the reason is worth knowing. The library's rule: **any program that uses
the bank calls reserves `&4000-&7FFF`, and the compiler refuses to run code that reaches it**
(the same restriction as double buffering). Lamplighter's program runs from `&0040` to `&68BD`, which
crosses `&4000`. To use banks it would have to be rebuilt to fit below `&4000` (about 16 KB, against 26.7 KB now)
or to live above `&8000`. The finished game keeps its songs and levels in main RAM, which is why the 464 and
6128 builds are one program.

(Bank-based level loading is not implemented in the finished game, so this part has no code to type. It is
an exercise in the Try this list.)

---

# Part 2: The CPC Plus

The Plus range (6128 Plus, 464 Plus, GX4000) has an extra chip, the **ASIC**. It gives a programmer 16
**hardware sprites**, a **12-bit palette** (4,096 colours instead of 27), hardware scrolling and more. The library
for it is `lib/cpcplus` (library: **CPC Plus (cpcplus)**).

Lamplighter Plus changes only what is drawn: **`game.bas` and `main.bas` are shared with every other
build** (they gain only a line in `main.bas`). It adds two things:

1. The player and enemies are hardware sprites: nothing to erase, nothing to redraw, no overlap rules.
   Moving a sprite is one call.
2. The lit lamps' **flames flicker**, by *palette cycling*: four colours rotated over four pens every
   other step.

## Step 3: What you need

- **A library that has the sprite manager and palette cycling.** They are `lib/cpcplus/sprman.bas` and
  `lib/cpcplus/palcycle.bas`, and the library copy bundled in the Studio extension has both
  (`cpcplus/sprman` and `cpcplus/palcycle` are in its `bundled/lib/`), so there is nothing to set. (If you
  pointed `cpcbuild.library.path` at your own copy of the library, it must be one that has them: `main` or the
  `platformer` branch.)
- **Art.** Copy from `games/lamplighter/assets/plus/` into your `assets/plus/`: `plus_tiles.png`,
  `plus_sprites.png`; and `pl_pens.bas`.
- **The Plus layer.** Copy `games/lamplighter/platform_plus.bas` into your project folder, beside
  `platform_cpc.bas`.

(The Plus art is drawn by a second Python script, `make_plus_art.py`, which also writes `pl_pens.bas`. Both
stay outside Studio: you are copying their finished output.)

## Step 4: The art

The Plus tile set is the same 16 tiles except that **tile 6, the lit lamp, draws its flame in pens 11 to 14**, which
no other tile uses (`make_plus_art.py` checks that). Cycling those four pens' colours animates every lit
lamp at once. The recipe is the CPC tiles' recipe with the Plus PNG:

`assets/plus/tiles.cpcimp`:

```json
{
  "format": "cpcimp",
  "version": 1,
  "source": "assets/plus/plus_tiles.png",
  "output": "assets/plus/tiles.bas",
  "target": "cpc",
  "mode": 0,
  "name": "tiles",
  "kind": "tiles",
  "palette": { "file": "assets/lamp.cpcpal" },
  "emitPalette": true
}
```

The sprites are **16 x 16 hardware sprites**: each art pixel is 2 sprite pixels wide, and the sprite is
magnified 2 x 1 (`SprMag(slot, 2, 1)`) so it covers the same 8 x 16 mode-0 pixels as the CPC build's. The
importer's target button is **Plus sprites**:

`assets/plus/lpsprites.cpcimp`:

```json
{
  "format": "cpcimp",
  "version": 1,
  "source": "assets/plus/plus_sprites.png",
  "output": "assets/plus/lpsprites.bas",
  "target": "plus-sprite",
  "name": "lpsprites"
}
```

These are the finished game's two commands (`build_assets.sh`):

```
python3 tools/img2cpc.py --mode 0 --name tiles --tiles --palette-file assets/lamp.cpcpal assets/plus/plus_tiles.png -o assets/plus/tiles.bas
python3 tools/img2cpc.py --plus-sprite --name lpsprites assets/plus/plus_sprites.png -o assets/plus/lpsprites.bas
```

A Plus sprite has at most 15 colours plus transparent; the sprite palette is the sheet's distinct colours in order
of first appearance, and the tool reports an error beyond 15. The result, `lpsprites`, is 12 frames of 256
bytes: 3,072 bytes. (Compare 1,536 for the CPC's masked frames.)

`pl_pens.bas` holds the 16 playfield pens as **12-bit colours** (two bytes a pen, the format
`SetPalette12Block` wants) and `pl_flame`, the four flame colours: amber, yellow, red-orange, pale yellow. It
was written by `make_plus_art.py`, not by an importer (it has no recipe: the file is a 12-bit pen table with no
PNG behind it); copy it. To make 12-bit colours yourself, run **CPCBuild: New Palette** and choose **Plus
palette** (it makes a `.cpcpal12`). The palette editor then shows **Entries**: pens 0 to 15, the border
(entry 16) and the 15 sprite colours (17 to 31), each as a three-digit hex colour (`F80`) with red, green and
blue from 0 to 15 in the **Entry details** panel. Its **Copy as** menu gives either **SetPalette12 lines** or
a **Byte array + SetPalette12Block**, the byte array that `SetPalette12Block` expects.

## Step 5: Teach the CPC layer about the Plus

`platform_plus.bas` does not replace `platform_cpc.bas`; it *includes* it and overrides some calls. For
that the CPC layer needs three small changes, each a `LAMP_PLUS` condition. Make them to your `platform_cpc.bas`:

**1.** The tile include (the Plus tiles have different art), and no software sprites:

```basic
#ifdef LAMP_PLUS
#include "assets/plus/tiles.bas"
#else
#include "assets/tiles.bas"
#include "assets/sprites.bas"
#endif
```

**2.** Wrap the software-sprite code (`PlatSprite`, `Overlap`, `PlatFlush`) in `#ifndef LAMP_PLUS` ... `#endif`.

**3.** In `PlatFrameEnd`, call the Plus flush instead of the CPC one:

```basic
#ifdef LAMP_PLUS
  PlatFlushPlus()
#else
  PlatFlush()
#endif
```

(`platform_cpc.bas:42-56, 159-226, 309-315`, each a few lines in the finished file.)

And `main.bas` picks the Plus layer when `PLUS` is defined:

```basic
#ifdef __CPC__
#ifdef PLUS
#include "platform_plus.bas"
#else
#include "platform_cpc.bas"
#endif
#else
#include "platform_zx.bas"
#endif
```

## Step 6: Read the Plus layer

Open `platform_plus.bas` (198 lines). The trick at the top is how it reuses the CPC layer:

```basic
#define LAMP_PLUS
...
#define PlatInit PlatInitCpc
#define PlatRoom PlatRoomCpc
#define PlatTile PlatTileCpc
#define PlatClear PlatClearCpc
#define PlatEnd PlatEndCpc
#include "platform_cpc.bas"
#undef PlatInit
#undef PlatRoom
#undef PlatTile
#undef PlatClear
#undef PlatEnd
```

(`platform_plus.bas:39-56`.) `#define` renames the five calls the Plus layer wants to replace *while the CPC file is
being read*, so they exist as `PlatInitCpc` and so on; `#undef` gives the names back, and the Plus layer defines its
own `PlatInit`, `PlatRoom`... which call the CPC versions. Everything else (text, HUD, keys, music) is inherited.

Then it includes the manager, the cycler and the data:

```basic
#include <cpcplus/sprman.bas>
#include <cpcplus/palcycle.bas>
#include "assets/plus/lpsprites.bas"
#include "assets/plus/pl_pens.bas"
```

**Sprites.** The *sprite manager* hands out hardware sprite slots as objects come and go, and keeps a cache so a
picture still in a slot is not uploaded twice (library: **Sprite manager**). The layer asks:

| Call | What it does here |
|---|---|
| `SprMgrInit(0, NSLOT)` | the manager owns hardware slots 0 to 4 (five: player and four enemies) |
| `SprAlloc(img)` | a slot for the 256-byte picture at `img`, when an object appears |
| `SprMag(slot, 2, 1)` | magnify 2 x 1, so 16 hardware pixels cover 8 mode-0 pixels |
| `SprSetImage(slot, img)` | a new picture (a new frame) |
| `SprMove(slot, x, y)` | position |
| `SprFree(slot)` | when the object hides |
| `SprFlush(maxUploads)` | does the queued uploads and shows the sprites, once a frame |

The heart of it is `PlatFlushPlus`, which `PlatFrameEnd` calls right after the frame wait:

```basic
img = @lpsprites(0) + (CAST(UINTEGER, f) << 8)
IF h = 255 THEN
  h = SprAlloc(img)
  IF h <> 255 THEN SprMag(h, 2, 1)
  pHs(s) = h
ELSEIF f <> pAf(s) THEN
  SprSetImage(h, img)
END IF
IF h <> 255 THEN
  SprMove(h, CAST(INTEGER, pWx(s)) << 2, pWy(s))
  ...
```

(`platform_plus.bas:156-166`.) Note `<< 2` on x: the hardware measures sprite positions in the finest
(mode-2) pixels, so a mode-0 pixel is **four** of them, and logical x times 4 is the hardware x. y is the line number.

`PlatSprite` only notes what each slot should show; the changes go to the manager after the frame wait, so
sprites never move part-way down the screen. A room change frees all slots and the manager's cache hands the
pictures back with no upload. And because hardware sprites sit above the screen, a lit lamp or door never needs a
sprite redrawn.

**Colours.** `SetPalette12Block(@pl_pens(0), 0, 16)` sets the 16 pens in 12 bits, `SetBorder12`, and
`SpritePalette(@lpsprites_pal(0))` the sprites' 15 colours. Blanking the screen while a room is drawn uses
16 black pens (`pBlack`).

**The flame.**

```basic
SUB FlameStart()
  PalCycleSet(0, 0, FLAME_PEN0, 4, @pl_flame(0), 2)
END SUB
```

(`platform_plus.bas:77-79`.) Cycle 0, kind 0 (**screen pens**), starting at pen `FLAME_PEN0` (11), 4 colours from
the `pl_flame` table, rotating by one every 2 calls of `PalCycleStep`. `PalCycleStep()`, called from `PlatFlushPlus`, once per game step, does the rotating:
a single block write, however many lamps are lit. The period counts those calls, so with a period of 2 the flame
advances every second step (`DESIGN.md`, section 13; library: **Palette cycling**). Setting the palette
restarts a cycle at offset 0, so the layer calls `FlameStart` again after every palette rewrite (every room).

## Step 7: Targets and build

In `cpcbuild.json` add the Plus targets (these are the Studio **Plus cartridge** template's):

```json
{ "id": "plus-cart", "arch": "cpc", "main": "main.bas", "model": "plus",
  "defines": ["PLUS"], "bare": true, "ownFont": true, "package": "cpr" }
```

`bare` adds `-D CPC_BAREMETAL` (the cartridge has no firmware) and `ownFont` adds `-D CPC_OWNFONT` (so it has no
firmware font either: the game's text comes from its own `fontcpc.bas` anyway). `package: cpr` runs
`tools/mkcpr.py`, which wraps the program in a cartridge image with a small boot stub that copies it to RAM at
`&0040`. These are the finished game's `lamppluc` flags (`build_plus.sh`).

Select `plus-cart` and run **CPCBuild: Build and Run**. The compiler flags are `--arch cpc --org 0x40 -D
PLUS -D CPC_BAREMETAL -D CPC_OWNFONT` (checked: compiling the finished sources with them gives a 30,056-byte
program, the `lamppluc.bin` of `DESIGN.md` section 13), and then `mkcpr.py` wraps it as `build/plus-cart.cpr`
(the finished game's cartridge is 49,188 bytes, 3 pages). The report is the one for a bare target, with its
own reference lines:

```
Build report for plus-cart:
  30056 bytes, &0040-&75A8
    passes &4000 by 13736 bytes (only matters if you use a back screen or banks)
    headroom below &B800: 16984 bytes  [bare limit]
```

(Worked out from the 30,056 bytes in the same way as in chapter 9: &0040 + 30,056 = &75A8.) The emulator tab
starts a Plus and boots the `.cpr` (Studio sends a `.cpr` to the Emulator extension, which always starts a
Plus for a cartridge); a cartridge boots by itself.
<!-- CHECK (for the user's test session): run plus-cart through Studio and the emulator tab, not only through the compiler and mkcpr.py as the tutorial's author did (that was run headless on CPCEC up to the title screen). Also confirm the report lines above. -->

## Build and run

You should see the title (the same as before, with two hardware sprites), then the game: the player and enemies are
smooth hardware sprites; there is no flicker. **Light a lamp** and look at its flame: lit lamps flicker together, in
amber, yellow, orange and pale yellow, and the effect costs one palette write every second step.

For comparison, the finished game's Plus screenshots (with the flame at two moments, `lit09` and `lit09b`) are in
`games/lamplighter/tests/golden/plus-cpcec/` and `plus-cap32/`.

What the numbers say (`DESIGN.md`, section 13, on Caprice32 and CPCEC; the finished game):

| | 464 build | Plus build |
|---|---|---|
| program size | 26,749 bytes | 30,505 bytes (disc), 30,056 (cartridge) |
| paced speed | 25.0 steps a second | 25.1 (498-499 frames) |
| unpaced, frames for 250 steps (500 is the budget) | 431 | 335 to 339 |
| headroom | about 14 % | about 32 to 33 % |

The Plus program is **3.8 KB bigger**: it adds the Plus library, the sprite manager, palette cycling and 3 KB of
sprites, and drops the software sprite code and frames. But a step needs about a fifth fewer frames (339 against
431) because nothing is erased and redrawn.

If the build says it cannot find `cpcplus/sprman.bas`, `cpcbuild.library.path` points at a library without it: clear
the setting (the bundled library has it) or use a checkout of `platformer` or `main`. If the game says "LAMPLIGHTER PLUS needs a CPC Plus" you ran a
firmware build on a model other than `plus`; the cartridge target has no such check because it can only run on a Plus.

### What is not covered here

The finished game also builds a **disc** for the Plus: `lampplus.dsk`, started with `RUN"PLUS`, where `PLUS.BIN`
is a small loader that starts the program (`build_plus.sh` makes it). That disc stays **outside Studio**:
Studio's `dsk` packaging makes a plain disc that runs one binary with `run"NAME`, and the finished project's
`lampplus` target is the cartridge only (`DESIGN.md` section 14). Whether a plain Studio disc build of the Plus
program (a target with `PLUS` defined, not `bare`) starts correctly on a Plus has not been checked: use the
cartridge target.
<!-- CHECK (optional, for the user's test session): add a disc target for the Plus program and see whether it boots on a Plus model; the tutorial's author did not try it. -->

## How it works

**Why wrapping works.** The game's calls are the contract (chapter 1). The Plus layer keeps the CPC layer
because most of it is unchanged, and overrides the five calls that touch sprites, rooms or tiles. Each Plus call
does its own work and then, where needed, calls the CPC original (`PlatInitCpc`, `PlatRoomCpc`...). That is
ordinary software layering done with the preprocessor, and it is also why the CPC layer needed the
`LAMP_PLUS` conditions.

**Hardware sprites versus erasing.** Chapter 4's software sprite costs about 26,000 T-states a move. A hardware
sprite costs one `SprMove`: **259 to 303 microseconds a call** in the library's measurements, about 1,000 to 1,200
T-states (**Sprite manager**, cost table). An upload (a new frame) is about 2.2 to 2.4 ms, which the manager spreads
over frames with a budget (`SprFlush(maxUploads)`); the layer's cache means a room change reuses pictures
already in the slots.

**Palette cycling.** A four-colour cycle, one due, costs about 779 to 876 microseconds in the library's table,
once every second step, for any number of lamps. Doing the same flicker in software would mean redrawing every
lit lamp tile, every time.

## Try this

1. Change `FLAME` colours in `pl_pens.bas` (`pl_flame`) to blues. Rebuild. Which lamps change?
2. Make the flame faster: the last argument of `PalCycleSet` is the period (counted in `PalCycleStep` calls, one per game step here). Try 1, then 4.
3. Use `PalCycleDir(0, 2)` (ping-pong) to make the flame breathe instead of rotate.
4. Give an enemy a different magnification: `SprMag(h, 4, 2)`. What breaks on collisions?
5. **6128 exercise.** Sketch what you would change to keep rooms 6 to 11 in a bank: what must move below `&4000`, and
   what does `MusicInitBank` need? How big is the song data compared with a room (460 bytes)?

## The end

You have built a complete game three ways, for four machines, from one set of rules. The pieces to reuse in your own
game: the **platform layer contract** (chapter 1), **rooms from Tiled** (3), **masked sprites with TileRestore**
(4), **table-driven movement** (5), **half-rate enemies** (6), the **measure first** habit (9), and the
**asset recipes** that keep art and code in step (2, 4, 10, 11).
