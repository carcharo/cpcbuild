# CPC library reference

The calls available to a Boriel BASIC program compiled with `--arch cpc`
beyond the standard language: screen basics and sound in `cpc.bas`, the
cpcbuild graphics and keyboard library, `font.bas`, and Play. For how the
architecture itself behaves (memory map, firmware gate, PRINT, floats) see
`docs/architectures/amstrad_cpc.md` in the compiler fork.

Contents

1. [Using the library](#1-using-the-library)
2. [Program origin](#2-program-origin)
3. [Coordinates](#3-coordinates)
4. [Data formats](#4-data-formats)
5. [Asset pipeline](#5-asset-pipeline)
6. [Extra RAM banks (6128)](#6-extra-ram-banks-6128)
7. [Double buffering](#7-double-buffering)
8. [Sound ownership](#8-sound-ownership)
9. [API reference](#9-api-reference)
10. [CPC Plus (cpcplus)](#10-cpc-plus-cpcplus)
11. [Performance tips](#11-performance-tips)

## 1. Using the library

```basic
#include <cpc.bas>          ' Mode, SetInk, SetBorder, WaitVsync, sound, AY
#include <cpcbuild.bas>     ' everything below (display, sprites, fill, tiles, keyboard, palette)
```

`cpcbuild.bas` includes six files that can also be included one at a time:
`<cpcbuild/display.bas>`, `<cpcbuild/sprites.bas>`, `<cpcbuild/fill.bas>`,
`<cpcbuild/tiles.bas>`, `<cpcbuild/keyboard.bas>`, `<cpcbuild/palette.bas>`.
Only the routines a program calls are compiled in. Other files: `<font.bas>`,
`<play.bas>`, `<point.bas>`, `<screen.bas>`, `<input.bas>`.

All of it is for `--arch cpc` only (the files stop with `#error` otherwise).
The routines are written from scratch and licensed MIT.

**Bare-metal mode.** The library also works in programs built with
`-D CPC_BAREMETAL` (no firmware; see the compiler's
[Bare-metal mode](https://github.com/carcharo/zxbasic/blob/cpc-arch/docs/architectures/amstrad_cpc.md#bare-metal-mode)
section). Drawing, sprites, tiles and the keyboard calls are unchanged. The
calls that asked the firmware do the work themselves: `ScreenInit`,
`WaitRetrace`, `WaitVsync`, the double-buffer flips and the palette calls
(notes at each call below). `BankLoad` is refused, since there is no disc.

Typical start of a program:

## 2. Program origin

By default a CPC program loads at &0040 (64), the lowest safe address, which leaves the most room for code and data (about 34.8 KB with the default heap). Any origin from &0040 up works with `--org`. Use the origin with the compiler and tools:

| Tool / build script | Option | Example |
|---|---|---|
| `zxbc` | `--org ADDR` | `zxbc --arch cpc --org 0x4000 ...` |
| `cpcrun.py` / `run.py` | `--org ADDR` | `cpcrun.py prog.bas --org 0x4000` |
| Makefile | `ORG=` | `make run PROG=prog.bas ORG=0x4000` |
| `build_assets.sh` and other scripts | `ORG=` environment variable | `ORG=0x4000 tools/cpc/run.sh prog.bas` |

The tools read the actual origin from the compiled binary's memory map, so `--org` and the default can never disagree with the packer.

**Caveat:** BASIC's firmware CALL writes &0040-&0047 just before a program starts, so a program loaded by `LOAD` + `CALL &0040` needs special handling (a stub at &A300 to restore the first 8 bytes; `cpcrun.py` does this for quickloads at &0040). **RUN" is safe:** AMSDOS loads last, after BASIC's write, so real RUN" at &0040 works fine on every model (464, 664, 6128).

## 3. Coordinates

```basic
#include <cpc.bas>
#include <cpcbuild.bas>

Mode 1                      ' switches mode, clears the screen
SetPalette(@pal(0), 4)      ' optional
ScreenInit()                ' always call after Mode
```

`Mode` does not tell the cpcbuild routines about the new screen; `ScreenInit()`
does (it reads the firmware's screen base and scroll offset). Call it after
every `Mode`.

The library compiles without warnings (since zxbasic `a7c325e6`): the
compiler doesn't report unused parameters (W150) or missing return values
(W190) for routines written in `asm`, which read their arguments from the
stack frame and return in registers, and it drops the library routines you
never call without a W170 for each.

Compile and run (from the compiler fork):

```sh
tools/cpc/run.sh ../cpcbuild/examples/bounce.bas
```

## 2. Coordinates

The library has its own coordinate system, chosen for speed. It differs from
PLOT/DRAW/CIRCLE.

| | cpcbuild library | PLOT, DRAW, CIRCLE, POINT | PRINT AT |
|---|---|---|---|
| Origin | top-left | bottom-left | top-left |
| x unit | bytes, 0-79 | mode pixels | character columns |
| y unit | pixel lines, 0-199, down | mode pixels, 0-199, up | character rows, 0-24 |

A screen byte is 2 pixels in mode 0, 4 in mode 1 and 8 in mode 2, and every
mode is 80 bytes wide:

| Mode | Pixels | Pens | Pixels per byte | Tile width | Tile cells | Text columns |
|---|---|---|---|---|---|---|
| 0 | 160 x 200 | 16 | 2 | 4 bytes | 20 x 25 | 20 |
| 1 | 320 x 200 | 4 | 4 | 2 bytes | 40 x 25 | 40 |
| 2 | 640 x 200 | 2 | 8 | 1 byte | 80 x 25 | 80 |

To convert: `byte column = pixel x / pixels per byte` (a shift by 1, 2 or 3).
Tile calls (`DoTile8`, `DoTile16`, `TileMap`, `TileMapPart`) take **tile
cells**: cell (cx, cy) is byte column `cx * tile width`, pixel line `cy * 8`.
`TileRestore` takes bytes and lines, like sprites.

Sprite, fill and block routines take `x` and `y` as signed 16-bit integers and
clip to the screen: any part outside 0-79 and 0-199 is skipped. `PokeScreen`
and `PeekScreen` take `ubyte` values and ignore anything off the screen. Tile
cells off the screen are skipped.

The screen is 16 KB at &C000 in eight 2 KB blocks: pixel line y is in block
`y AND 7`, at byte `(y >> 3) * 80 + x` of that block. When the firmware
scrolls text it moves the CRTC start address instead of copying memory, so
after a scroll the top-left byte moves. The library reads the offset (in
`ScreenInit`, `WaitRetrace` and `FlipBuffer`) and adds it, wrapping inside the
2 KB block, so drawing stays right after text scrolls. `Mode` resets the
scroll. Several routines have fast paths that need no wrapping (see
[Performance tips](#8-performance-tips)).

## 4. Data formats

All graphics data is in **screen-byte format for the mode in use**: bytes copied
as they are to screen memory. A program for one mode needs assets built for
that mode. All arrays are `UBYTE`.

### Screen byte

| Mode | Layout (bit 7 is the leftmost pixel's) |
|---|---|
| 0 | 2 pixels. Left pixel: pen bits 0-3 in screen bits 7, 3, 5, 1. Right pixel: the same one bit lower (6, 2, 4, 0). |
| 1 | 4 pixels. Pixel n (0 = left): pen bit 0 in bit 7-n, pen bit 1 in bit 3-n. |
| 2 | 8 pixels. Pixel n: bit 7-n. |

`PenByte(pen)` gives the byte with every pixel in one pen. `img2cpc.py` does the
encoding for real art; hand-written data is rarely needed.

### Sprite

`w` bytes by `h` lines, rows top first, left to right, `w * h` bytes. For
`PutSprite` and `GetBlock`. `w` and `h` are 1-255.

### Masked sprite

`w` bytes by `h` lines of (mask, pixels) byte pairs, `w * h * 2` bytes, row by
row. The screen byte becomes `(screen AND mask) OR pixels`: a mask bit of 1 keeps
the background, 0 replaces it. A transparent pixel has all its mask bits 1 and
its pixel bits 0.

### Tile and tile set

A tile is 8 x 8 pixels: 8 rows, top first, each row `tile width` bytes
(1, 2 or 4 bytes in mode 2, 1, 0): **8, 16 or 32 bytes per tile**. A tile set is
the tiles one after another; tile n starts at `n * bytes per tile`. `SetTileSet`
gives its address. `DoTile8` and the maps take tile numbers 0-255 (one byte).
`DoTile16(x, y, t)` draws the four 8 x 8 tiles `4t` to `4t+3` (top-left,
top-right, bottom-left, bottom-right).

### Tile map

One byte per cell, tile numbers, row-major, `w` bytes per row. Maps with
`mapw` bytes per row are used with `TileMapPart` and `TileRestore`.

### Palette

One byte per pen, in pen order (pen 0 first): a **firmware colour number 0-26**.
Entries above 26 are skipped; only pens 0-15 can be set.

| 0 black | 1 blue | 2 bright blue | 3 red | 4 magenta | 5 mauve | 6 bright red |
|---|---|---|---|---|---|---|
| **7 purple** | **8 bright magenta** | **9 green** | **10 cyan** | **11 sky blue** | **12 yellow** | **13 white** |
| **14 pastel blue** | **15 orange** | **16 pink** | **17 pastel magenta** | **18 bright green** | **19 sea green** | **20 bright cyan** |
| **21 lime** | **22 pastel green** | **23 pastel cyan** | **24 bright yellow** | **25 pastel yellow** | **26 bright white** | |

These are the firmware's numbers (as in Locomotive BASIC's INK), not the Gate
Array's hardware codes.

## 5. Asset pipeline

Two Python tools in `tools/` turn art into Boriel include files. They are MIT
licensed, written from scratch, and generate plain `DIM ... => {...}` arrays and
`CONST` values. `img2cpc.py` needs Pillow (`pip install pillow`); `tmx2bas.py`
uses only the standard library. Run them from the cpcbuild repository root.

### img2cpc.py: PNG to sprites, masked sprites, tiles

One PNG pixel is one CPC pixel (no aspect correction): mode 0 art is 160 pixels
wide, mode 1 320, mode 2 640. The width must be a multiple of the pixels per
byte (2, 4, 8). Tile images must also be a multiple of 8 high.

| Option | Meaning |
|---|---|
| `--mode 0\|1\|2` | CPC screen mode (required). |
| `--name NAME` | Array name prefix (default: the file stem). |
| `-o FILE` | Output `.bas` (default: standard output). |
| `--sprite` | The whole image is a sprite (default). |
| `--frame WxH` | With `--sprite`: cut the image into frames of W x H **pixels**, row-major. W must be a multiple of the pixels per byte. |
| `--tiles` | Cut into 8 x 8 tiles, row-major. |
| `--dedupe` | With `--tiles`: drop repeated tiles and emit a map. |
| `--masked` | Emit (mask, pixels) pairs. A pixel is transparent if its alpha is below 128 or it is `--transparent`. |
| `--transparent RRGGBB` | A colour to treat as transparent. |
| `--palette 0,26,6,18` | Fixed pens (firmware colours); each image colour takes the nearest pen. |
| `--palette-file F` | The same, read from a file (comma or whitespace separated, `#` comments). |
| `--pen0 N` | With a palette built from the image: the firmware colour (0-26) given to pen 0. |
| `--no-palette` | Do not emit `NAME_pal` and `NAME_PENS`. |
| `--write-palette F` | Save the palette used, so other images can share it with `--palette-file`. |
| `--spectrum` | Emit a ZX Spectrum bitmap plus attributes instead (see below). |

Without `--palette`, the palette is built from the image: each colour goes to its
nearest of the 27 firmware colours and the distinct ones take pens in order of
first appearance. More colours than the mode has pens is an error.

Generated names, with `NAME`:

| Kind | Emitted |
|---|---|
| Sprite | `NAME` (data), `NAME_W` (bytes), `NAME_H` (lines), `NAME_FRAMES`, `NAME_SIZE` (bytes per frame) |
| Tiles | `NAME` (data), `NAME_COUNT`; with `--dedupe` also `NAME_MAP`, `NAME_MAPW`, `NAME_MAPH` |
| Palette | `NAME_pal` (one byte per pen), `NAME_PENS` (count) |

Example, a masked sprite sheet of 16 x 16 frames in mode 1:

```sh
python3 tools/img2cpc.py --mode 1 --name hero --masked --frame 16x16 \
    --palette 0,26,6,18 hero.png -o hero.bas
```

```basic
#include "hero.bas"        ' relative to this source file
...
SetPalette(@hero_pal(0), hero_PENS)
PutSpriteMasked(x, y, hero_W, hero_H, @hero(frame * hero_SIZE))
```

Share one palette between several images: write it with the first
(`--write-palette pens.pal`), then use `--palette-file pens.pal` with
`--no-palette` for the rest (as `tools/build_assets.sh` does for the bounce demo).

Tile set from an image of tiles:

```sh
python3 tools/img2cpc.py --mode 0 --name bgtiles --tiles --palette-file bounce.pal bgtiles.png -o bgtiles.bas
```

`--spectrum` writes ZX Spectrum data from the same PNG, for a program that is
also built for `--arch zx48k`: `NAME` (8 bytes per 8 x 8 cell, UDG order),
`NAME_attr` (one attribute byte per cell), `NAME_COLS`, `NAME_ROWS`. Width and
height must be multiples of 8.

### tmx2bas.py: Tiled maps to tile maps

```sh
python3 tools/tmx2bas.py level.tmx --name level -o level.bas
```

Reads a tile layer of a Tiled `.tmx` file (`--layer NAME`, default the first
tile layer; csv or base64 with no compression, zlib or gzip) and emits
`DIM level(n) AS UBYTE => {...}` with `w * h` tile numbers, row-major, plus
`level_W` and `level_H` in tiles. The tile number is the gid minus the first
tileset's firstgid (`--firstgid` overrides it), with Tiled's flip and rotation
bits stripped. An empty cell becomes `--empty N` (default 0). A tile number above
255 is an error; infinite (chunked) maps and zstd data are not supported.

```basic
SetTileSet(@bgtiles(0))
TileMap(@level(0), 0, 0, level_W, level_H)
```

### build_assets.sh

`tools/build_assets.sh` regenerates every committed generated include (the
`.bas` files next to their `.png` and `.tmx` sources in `examples/assets/` and
`tests/conformance/assets/`) and is the best list of example command lines.
`tools/build_assets.sh --draw` redraws the source art first. The output is
reproducible byte for byte.

### Assets: songs

Songs and sound-effects banks are generated from Arkos Tracker files (.aks, or other
formats the Arkos command-line tools import, like Vortex Tracker .vt2) using `tools/aks2bas.py`:

```sh
python3 tools/aks2bas.py tune.aks tune.bas --name tune
python3 tools/aks2bas.py --sfx sfx.aks sfx.bas --name sfx
```

The output is a Boriel include with the song or effects data. Use them with the music library:

```basic
#include <music/music.bas>
#include "tune.bas"
#include "sfx.bas"

MusicInit(@tune, 0)                 ' start the song on subsong 0
SfxInit(@sfx)
SfxPlay(1, 0, 0)                    ' play effect 1 on channel A at full volume
```

The Arkos Tracker tools are MIT licensed (see `tools/arkos/README.md` for versions and sources).
Test songs come from the Arkos Tracker repository with its MIT licence notice; the bundled
example songs have no licence and are not used in cpcbuild.

## 6. Extra RAM banks (6128)

The CPC 6128 has 64 KB of extra RAM in four 16 KB banks. A program can use banks to hold
songs, sprites, tiles, or code, freeing main RAM for other data.

```basic
#include <cpcbuild/banks.bas>

IF BankAvailable() THEN
    BankLoad("TUNE.DAT", 0, &H4000)     ' load a song into bank 0
    MusicInitBank(&H4000, 0, 0)         ' play it from there
END IF
```

### API

| Call | Returns | Notes |
|---|---|---|
| `BankAvailable()` | 1 or 0 | 1 on a 6128 or equipped 464/664; 0 otherwise |
| `BankSelect(n)` | — | Select bank 0-3 (appears at &4000-&7FFF), or 255 for main RAM |
| `BankOff()` | — | Equivalent to BankSelect(255) |
| `BankSelected()` | 0-3 or 255 | Which bank is in, or 255 for main RAM |
| `BankPeek(bank, addr)` | Byte value | Read from a bank without selecting it; addr = &4000-&7FFF |
| `BankPoke(bank, addr, v)` | — | Write to a bank without selecting it |
| `BankCopyIn(bank, bankaddr, src, len)` | 1 or 0 | Copy from main RAM into a bank (1 if done, 0 if no RAM or bad range) |
| `BankCopyOut(bank, bankaddr, dst, len)` | 1 or 0 | Copy from a bank into main RAM |
| `BankLoad(file$, bank, addr)` | 1 or 0 | Load an AMSDOS disc file into a bank; 1 if done, 0 on error |

### Rules

* **Reserved space:** Any program using these routines reserves &4000-&7FFF; the compiler refuses to run code that reaches it (same restriction as double buffering).
* **Bank selection and drawing:** While a bank is selected, &4000-&7FFF is the bank. Do not call `FlipBuffer` or sprite/tile drawing while double buffering is on, as they would write to the bank instead of the screen. Select the bank, use it, then `BankOff()` before drawing.
* **The music player:** `MusicInitBank(song, subsong, bank)` plays a song from a bank. It pages the bank in around each tick (about 110 T-states per frame) and restores the RAM configuration from the library's shadow, so a bank the main program selected survives the music hook.
* **Copies:** `BankCopyIn` and `BankCopyOut` copy in chunks of at most 256 bytes with interrupts off (about 1.3 ms per chunk), so no interrupt is lost.
* **BankLoad:** Loads an AMSDOS file (with its header) straight into a bank. The file needs the disc ROM (AMSDOS); BankLoad runs `|DISC` first. With no disc ROM it returns 0 at once. The call needs about 2 KB of heap; the default 4.7 KB is enough.
  **Bare-metal mode:** BankLoad is refused (compile error); a firmware-mode loader must load the data before the bare program runs.
* **464/664:** BankSelect/Off/Peek/Poke do nothing (Peek reads 0) and the copies return 0 on machines without extra RAM.

### Songs in banks

Generate the song at its bank address and include the raw bytes:

```bash
python3 tools/aks2bas.py tune.aks tune.bas --name tune --at 0x4000 --bin
```

This generates `tune.bas` (the image for `BankCopyIn`) and a raw binary for `BankLoad`:

```basic
#include <cpcbuild/banks.bas>
#include <music/music.bas>
#include "tune.bas"       ' defines tune and tune_length

BankCopyIn(1, &H4000, @tune, tune_length)  ' or BankLoad("TUNE.BIN", 1, &H4000)
MusicInitBank(&H4000, 0, 1)                ' play from bank 1
```

The song's addresses are absolute (&4000-&7FFF inside the bank); the player pages the bank in and out around each tick. `MusicInitBank` does nothing on a 464/664 without extra RAM; check `BankAvailable()` first if the program must run on every model.

Cost (bench/boriel/banks_bench.bas, chips): BankPeek/Poke about 550 T-states from BASIC per call; a copy about 1,200 per call plus 25 per byte.

## 7. Double buffering

Opt-in. The CRTC can only display a screen at &0000, &4000, &8000 or &C000, so the
second screen is &4000-&7FFF.

```basic
Mode 0
ScreenInit()
...draw the first frame...        ' on the shown screen (&C000)
EnableDoubleBuffer()              ' copies it to &4000, draws there from now on
DO
    ...erase and draw...          ' goes to the hidden screen
    FlipBuffer()                  ' at the next flyback show it, draw on the other
LOOP UNTIL KeyDown(KEY_ESC)
DisableDoubleBuffer()
```

Rules:

* **Memory.** A program that calls `EnableDoubleBuffer` must fit its code and
  data in &0040-&3FFF (about 16 KB), and its heap must lie above &7FFF. The compiler
  stops with an error if not. Programs that never call it are unaffected.
* **What draws where.** After `EnableDoubleBuffer`, every cpcbuild call
  (`PutSprite`, `FillRect`, `TileMap`, `ClearScreen`, `PokeScreen`,
  `GetBlock` ...) uses the hidden screen. The screen on view changes only in
  `FlipBuffer`.
* **PRINT draws on the screen being shown**, not the hidden one: the firmware
  draws on the screen it displays. Text printed while double buffering appears on
  the shown screen and is overwritten when the frames swap. Draw text into both
  screens, or use the library's drawing only. **Text must not scroll** while
  double buffering is on (the firmware would scroll only the shown screen).
  PLOT, DRAW and CIRCLE are firmware routines too and are not part of the
  double-buffering design; use the library's drawing calls on the hidden screen.
* **The hidden screen is two frames behind.** After a flip, the hidden screen holds
  the picture drawn two frames ago. A program that erases and redraws moving
  objects must erase each object where that screen last showed it, so keep two
  sets of positions (bounce.bas keeps `OX/OY` for each screen).
* `FlipBuffer` waits for the flyback, so a loop that ends in `FlipBuffer` runs
  at most once per frame. Without double buffering it only waits for the flyback.
* `DisableDoubleBuffer` leaves &C000 shown with the last frame (copied from
  &4000 if that was showing).

## 8. Sound ownership

The AY sound chip has one owner at a time.

* The **firmware sound manager** (BEEP, `SoundQueue`, `SoundEnvelope`) plays
  from the interrupt handler and writes the chip by itself whenever a note is
  queued. For programs without a music player, running outside game mode.
  (Bare-metal mode: there is no sound manager; `SoundQueue` and the other
  sound-manager calls are refused, and BEEP drives the AY directly.)
* The **music player** (Arkos Tracker 3: `MusicInit`, `SfxPlay`) plays from the
  frame hook. It owns the AY while a song plays; sound effects work in game mode
  and normal mode. (Bare-metal mode: same.)
* **Direct access** (`AyWrite`, the Play library) programs the chip itself.
  (Bare-metal mode: same; `SoundStop` silences the chip with direct AY writes.)

A program uses one of them at a time. Before direct access, call `SoundStop`
once (Play does this for you), and queue no firmware sounds while it lasts. `MusicInit`
calls `SoundStop` so the manager is idle. After using direct access, call `SoundStop`
before BEEP or `SoundQueue` again. Play and the music player run with interrupts
off, so the keyboard and the firmware clock stop meanwhile (the music player only
outside firmware calls; in game mode the firmware stops anyway). In bare mode the
same one-owner rule applies: BEEP writes the AY itself, so no BEEP while a song
plays.

## 9. API reference

Types are Boriel types. Calls that are **subs** return nothing. "Gate" means the
call goes through the firmware gate (about 220 T-states plus the firmware
routine). Costs are CPC effective T-states (every instruction rounded up to a
multiple of 4 T, 4 per microsecond; a frame is 20 ms or 80,000 T), measured in
Caprice32. They are the routine's own cost; with interrupts always on, the
firmware takes about 12 % of the CPU on top, so wall-clock time is longer.

### 7.1 Screen basics (`cpc.bas`)

| Call | Parameters | Returns |
|---|---|---|
| `Mode n` | `n AS UBYTE`: 0, 1 or 2 | sub |
| `GetMode()` | | `UBYTE`: the current mode |
| `SetInk pen, colour` | `pen AS UBYTE` 0-15; `colour AS UBYTE` firmware colour 0-26 | sub |
| `SetBorder colour` | `colour AS UBYTE` 0-26 | sub |
| `WaitVsync` | | sub |

**Mode** switches the screen mode (SCR_SET_MODE), sets the runtime's per-mode
variables (pen map, text width, graphics scaling) and clears the screen to the
current PAPER. `n` is masked to 0-3; mode 3 is the undocumented 4-pen 160 x 200
hardware mode and is not a library mode. Call `ScreenInit()` afterwards.

**GetMode** returns the mode the firmware reports (SCR_GET_MODE).

**SetInk** sets a pen's colour. It is set in the firmware (not flashing) and also
written straight to the Gate Array, so it shows at once and recolours everything
drawn in that pen. Pens above 15 and colours above 26 are ignored (use
`SetBorder` for the border). PRINT's INK, PAPER and BORDER still take Spectrum
colours 0-7 and map them to pens; `SetInk` changes what a pen looks like.

**SetBorder** sets the border colour the same way (firmware plus Gate Array).

**WaitVsync** waits for the start of the next flyback (MC_WAIT_FLYBACK). It
returns at once if the flyback has already started, so call it once per frame.
Unlike `WaitRetrace` it does not re-read the scroll offset.

**Bare-metal mode:** waits for the next frame on the runtime's frame counter
(no firmware call).

Cost: each of these is one or two gate calls.

```basic
Mode 1
SetInk 0, 0                 ' pen 0 black
SetInk 1, 26                ' pen 1 bright white
SetBorder 0
PRINT INK 1; "Hello"
```

### 7.2 Display (`cpcbuild/display.bas`)

| Call | Parameters | Returns |
|---|---|---|
| `ScreenInit()` | | sub |
| `WaitRetrace(frames)` | `frames AS UINTEGER` | sub |
| `EnableDoubleBuffer()` | | sub |
| `DisableDoubleBuffer()` | | sub |
| `FlipBuffer()` | | sub |
| `PokeScreen(x, y, value)` | `x, y, value AS UBYTE`; x in bytes 0-79, y in lines 0-199 | sub |
| `PeekScreen(x, y)` | `x, y AS UBYTE` | `UBYTE` |

**ScreenInit** reads the firmware's screen base and hardware-scroll offset. Call
it at start-up, after `Mode`, and after anything else that changes the screen.

**Bare-metal mode:** the screen base is always &C000 and the scroll offset
is always 0 (text scrolls in software).

**WaitRetrace** waits for the start of `frames` frame flybacks. 0 counts as 1.
Each wait first lets any flyback in progress finish, so every count is a new
frame. Interrupts run during the wait. It then re-reads the scroll offset. (Name
as NextBuild's `WaitRetrace`.)

**Bare-metal mode:** waits for `frames` frame changes from the frame counter
(no scroll re-read).

**EnableDoubleBuffer, DisableDoubleBuffer, FlipBuffer** are described in
[Double buffering](#5-double-buffering). `FlipBuffer` shows what was drawn at the
next flyback and then draws on the other screen; with double buffering off it only
waits for the flyback. `EnableDoubleBuffer` copies the shown screen to the hidden
one first.

**Bare-metal mode:** the flips write CRTC registers R12 and R13 directly (no
firmware call), and PRINT follows the shown screen as it does in firmware
mode.

**PokeScreen** writes one screen byte of the drawing screen. A position off the
screen (x of 80 or more, y of 200 or more) is ignored. **PeekScreen** reads one
back (0 off the screen).

```basic
WaitRetrace(2)              ' wait two frames
PokeScreen(10, 100, PenByte(1))
```

### 7.3 Sprites (`cpcbuild/sprites.bas`)

| Call | Parameters | Returns |
|---|---|---|
| `PutSprite(x, y, w, h, spr)` | `x, y AS INTEGER`; `w, h AS UBYTE`; `spr AS UINTEGER` | sub |
| `PutSpriteMasked(x, y, w, h, spr)` | as above | sub |
| `GetBlock(x, y, w, h, buffer)` | as above; `buffer AS UINTEGER` | sub |

x is in bytes, y in lines, from the top-left; both may be negative or past the far
edge. `w` is the width in bytes and `h` the height in lines, 1-255. `spr` is the
address of the data (`@name(0)`).

* **PutSprite** copies `w * h` bytes (format: [Sprite](#sprite)) to the screen.
* **PutSpriteMasked** draws `w * h` (mask, pixels) pairs ([Masked
  sprite](#masked-sprite)): `screen = (screen AND mask) OR pixels`.
* **GetBlock** copies the screen area into `buffer` (`w * h` bytes), to restore
  later with `PutSprite`. Parts clipped away are not read: the buffer keeps its
  full `w`-byte rows, and the cut-off part is left untouched.

All three clip to the screen (the source rows and bytes outside are skipped; the
data keeps its full layout) and draw on the drawing screen.

Cost, a 16 x 16 mode-0 sprite (4 x 16 bytes, not clipped, no scroll offset):

| Call | T-states |
|---|---|
| `PutSprite` | 3,773 |
| `PutSpriteMasked` | 5,283 |
| `GetBlock` | 3,652 |

(The first, generic version took about 6,000, 9,050 and 5,900.) A width of 1, 2, 4
or 8 bytes that is not clipped at the sides takes an unrolled fast path; other
widths use the generic loops.

```basic
PutSprite(0, 0, 4, 16, @ship(0))
GetBlock(x, y, 4, 16, @under(0))      ' save the background
PutSpriteMasked(x, y, 4, 16, @ball(0))
PutSprite(x, y, 4, 16, @under(0))     ' put it back
```

### 7.4 Fill (`cpcbuild/fill.bas`)

| Call | Parameters | Returns |
|---|---|---|
| `PenByte(pen)` | `pen AS UBYTE` | `UBYTE` |
| `FillRect(x, y, w, h, pen)` | `x, y AS INTEGER`; `w, h, pen AS UBYTE` | sub |
| `ClearScreen(pen)` | `pen AS UBYTE` | sub |

**PenByte** returns the screen byte with every pixel in that pen for the current
mode (mode 0: pens 0-15, mode 1: 0-3, mode 2: 0-1). The pen is masked to the
mode's range.

**FillRect** fills a rectangle with a pen. x and w are in bytes, y and h in lines,
from the top-left, clipped to the screen.

**ClearScreen** fills the whole 16 KB of the drawing screen with a pen. It uses the
stack pointer as a fill pointer, in 64-byte chunks with interrupts off between
(each chunk short, the real SP restored in between), and takes about 25 ms.

```basic
ClearScreen(0)
FillRect(10, 20, 8, 40, 2)    ' 8 bytes wide, 40 lines high, pen 2
```

### 7.5 Tiles (`cpcbuild/tiles.bas`)

| Call | Parameters | Returns |
|---|---|---|
| `SetTileSet(addr)` | `addr AS UINTEGER` | sub |
| `DoTile8(x, y, tile)` | `x, y, tile AS UBYTE`; x, y in tile cells | sub |
| `DoTile16(x, y, tile)` | as above; x, y in 16 x 16 cells | sub |
| `TileMap(map, x, y, w, h)` | `map AS UINTEGER`; `x, y, w, h AS UBYTE` in tile cells | sub |
| `TileMapPart(map, mapw, x, y, w, h)` | `map AS UINTEGER`; `mapw, x, y, w, h AS UBYTE` | sub |
| `TileRestore(map, mapw, x, y, w, h)` | `map AS UINTEGER`; `mapw, x, y, w, h AS UBYTE`; x, w in bytes, y, h in lines | sub |

None of these calls the firmware (safe on every model) and none needs the gate.
All draw on the drawing screen and work with a scroll offset. Tile formats:
[Tile and tile set](#tile-and-tile-set), [Tile map](#tile-map).

* **SetTileSet** sets the address of the tile data used by all later calls.
* **DoTile8** draws tile number `tile` at cell (x, y): byte column `x * tile
  width`, pixel line `y * 8`. A cell off the screen draws nothing.
* **DoTile16** draws a 16 x 16 tile made of the 8 x 8 tiles `4t` to `4t+3` at
  16 x 16 cell (x, y), that is 8 x 8 cells (2x, 2y) to (2x+1, 2y+1).
* **TileMap** draws a `w` x `h` block of 8 x 8 tiles whose numbers are the bytes
  at `map` (row-major, `w` per row), top-left at cell (x, y). Cells off the screen
  are skipped.
* **TileMapPart** is the same for a block taken out of a wider map: `map` is the
  address of the block's first byte and its rows are `mapw` bytes apart
  (`mapw >= w`). For example, a block whose top-left is map cell (c, r):
  `TileMapPart(@level(r * mapw + c), mapw, x, y, w, h)`.
* **TileRestore** redraws the tiles under a screen rectangle (x and w in bytes,
  y and h in lines, the same units as a sprite), from a map of `mapw` bytes per
  row that is laid out from screen cell (0, 0): it draws every cell the rectangle
  touches. It erases a sprite in one call:
  `TileRestore(@level(0), level_W, x, y, balls_W, balls_H)`.
  The map's rows must cover the screen cells the rectangle touches. When the
  rectangle is on the screen and no row can wrap (no scroll offset) it takes a
  short path; otherwise the general path through `TileMapPart`.

Cost (T-states): `DoTile8` 1,179 in mode 1 and 1,546 in mode 0; `TileMap` about
839 per tile in mode 1 and 1,199 in mode 0 for a full screen. The first version
took 1,853 / 2,639 and 1,466 / 2,204. From BASIC in mode 0, a
`DoTile8` call measured about 2.3k in bounce.bas, so the BASIC call itself costs
roughly 0.7k on top.

```basic
SetTileSet(@bgtiles(0))
TileMap(@level(0), 0, 0, level_W, level_H)      ' the whole background
DoTile8(5, 3, 2)                                ' one cell
TileRestore(@level(0), level_W, x, y, 4, 16)    ' erase a 4 x 16-byte sprite
```

### 7.6 Keyboard (`cpcbuild/keyboard.bas`)

| Call | Parameters | Returns |
|---|---|---|
| `ScanKeys()` | | sub |
| `KeyDown(key)` | `key AS UBYTE`: a firmware key number 0-79 | `UBYTE`: 1 if down at the last scan, else 0 (also 0 above 79) |
| `AnyKeyDown()` | | `UBYTE`: 1 if any key was down at the last scan |

**ScanKeys** reads the whole 10 x 8 keyboard matrix straight from the hardware
into a buffer (interrupts off for the scan, back on after; no firmware call).
Call it once per frame (for example after `WaitRetrace` or `FlipBuffer`), then
test any number of keys with `KeyDown`. It leaves the PPI as the firmware expects,
so `INKEY$` and `INPUT` keep working, and the firmware's own scan still fills its
key buffer during the program (INPUT empties it when it starts). Two keys held together can "ghost" a third, as on
any CPC. A key pressed for less than a frame can be missed.

A key number is `row * 8 + bit` of the matrix. Use the constants:

| Group | Constants |
|---|---|
| Cursor and control | `KEY_UP` 0, `KEY_RIGHT` 1, `KEY_DOWN` 2, `KEY_LEFT` 8, `KEY_ENTER` 6 (keypad), `KEY_RETURN` 18, `KEY_SHIFT` 21, `KEY_CONTROL` 23, `KEY_ESC` 66, `KEY_DEL` 79, `KEY_SPACE` 47, `KEY_TAB` 68 |
| Digits | `KEY_0` 32, `KEY_1` 64, `KEY_2` 65, `KEY_3` 57, `KEY_4` 56, `KEY_5` 49, `KEY_6` 48, `KEY_7` 41, `KEY_8` 40, `KEY_9` 33 |
| Letters | `KEY_A` 69, `KEY_B` 54, `KEY_C` 62, `KEY_D` 61, `KEY_E` 58, `KEY_F` 53, `KEY_G` 52, `KEY_H` 44, `KEY_I` 35, `KEY_J` 45, `KEY_K` 37, `KEY_L` 36, `KEY_M` 38, `KEY_N` 46, `KEY_O` 34, `KEY_P` 27, `KEY_Q` 67, `KEY_R` 50, `KEY_S` 60, `KEY_T` 51, `KEY_U` 42, `KEY_V` 55, `KEY_W` 59, `KEY_X` 63, `KEY_Y` 43, `KEY_Z` 71 |
| Joystick 0 | `JOY_UP` 72, `JOY_DOWN` 73, `JOY_LEFT` 74, `JOY_RIGHT` 75, `JOY_FIRE1` 76, `JOY_FIRE2` 77 |

Other keys (punctuation, function keys, CAPS LOCK, COPY, CLR) have no constant;
pass the firmware key number directly. Row 9 holds joystick 0, which shares the
matrix with DEL.

```basic
DO
    WaitRetrace(1)
    ScanKeys()
    IF KeyDown(KEY_LEFT) OR KeyDown(JOY_LEFT) THEN x = x - 1
    IF KeyDown(KEY_RIGHT) OR KeyDown(JOY_RIGHT) THEN x = x + 1
LOOP UNTIL KeyDown(KEY_ESC)
```

### 7.7 Palette (`cpcbuild/palette.bas`)

| Call | Parameters | Returns |
|---|---|---|
| `SetPalette(colours, count)` | `colours AS UINTEGER`: address of `count` bytes; `count AS UBYTE` | sub |
| `PalUpload(colours, count, first)` | as above; `first AS UBYTE`: first pen | sub |

`SetPalette` gives pens 0 to `count - 1` the firmware colour numbers (0-26) found
at `colours`. `PalUpload` does the same for pens `first` to `first + count - 1`
(NextBuild's name). Entries above 26 are skipped, pens above 15 are not set
(upload stops after pen 15), and flashing inks are not set. A count of 0 does
nothing. Each colour goes through the firmware (SCR_SET_INK, so its tables stay
right) and also to the Gate Array, so it shows at once. Cost: one gate call per
pen.

Always set colours through these calls (or `SetInk`/`SetBorder`), not by
writing the Gate Array yourself. The firmware's interrupt handler, which runs all
the time, rewrites all 16 inks and the border from its own tables every 10
frames or so (its flashing-ink cycle, even when nothing flashes). So a colour
written only to the Gate Array is gone within about 0.2 s. The library calls
put the same colour in the firmware's tables, so they survive.

**Bare-metal mode:** writes the Gate Array directly (no firmware call; colour
changes show at once).

```basic
DIM pal(3) AS UBYTE => {0, 26, 6, 18}     ' black, bright white, bright red, bright green
SetPalette(@pal(0), 4)
PalUpload(@pal(0), 2, 8)                  ' pens 8 and 9
```

### 7.8 Frame hook and game mode (`framehook.bas`)

| Call | Parameters | Returns |
|---|---|---|
| `FrameHook(addr)` | `addr AS UINTEGER`: address of a machine-code routine | sub |
| `FrameHookOff()` | | sub |
| `Frames()` | | `ULONG`: frames since the program started |
| `GameMode(on)` | `on AS UBYTE`: 1 to enable, 0 to disable | sub |

The frame hook is a machine-code routine that runs once per frame at the frame flyback,
with interrupts off and all registers saved (BC, DE, HL, AF, IX, IY and the alternate
bank). It is called in every screen mode, including while the program waits inside a
firmware call (PRINT, WaitRetrace, etc.), exactly once per frame.

**FrameHook** installs a routine to run on every frame. The routine must not call the
firmware, PRINT, or use floats or strings: write it in an `asm` block with a label,
and pass its address (`@label`). A typical use is a music player that advances one tick
per frame regardless of the main loop's speed.

**FrameHookOff** stops the hook.

**Frames** returns a count since the program started, one per frame. Use it instead of
the firmware's 300 Hz clock in programs that switch game mode.

**GameMode(1)** switches to game mode: outside firmware calls the firmware's own interrupt
handler stops, saving about 10-11 % of the CPU (from about 12 % baseline to about 1-2 %).
While in game mode and not inside a firmware call, the firmware's key buffer (INPUT; INKEY$ is a direct scan and keeps working),
300 Hz clock, sound queue (BEEP/SoundQueue) and ink refresh stop; use `ScanKeys`, `Frames()`,
the music player and its sound effects, or `AyWrite` instead. Firmware calls themselves still
work, and inside them the firmware handles interrupts as usual. **GameMode(0)** switches back
to normal mode.

The frame hook and game mode are best proven in an emulator first, as the design uses
firmware features (a far-address frame-flyback event with ROM select &FF) to run at every
frame outside the normal interrupt model.

Cost: each call is one or two lines of inline assembly.

```basic
#include <framehook.bas>

GameMode(1)                         ' opt-in: more CPU for the loop
DO
    WaitRetrace(1)                  ' wait for the next frame flyback
    ScanKeys()                      ' read the keyboard (firmware's buffer is off)
    f = Frames()                    ' the frame counter
    ' ... game loop ...
LOOP UNTIL KeyDown(KEY_ESC)
GameMode(0)                         ' back to normal
```

### 7.9 Music and sound effects (Arkos) (`music.bas` — CPC and Spectrum 128K)

| Call | Parameters | Returns |
|---|---|---|
| `MusicInit(song, subsong)` | `song AS UINTEGER`: address of AKG song data; `subsong AS UBYTE`: subsong number (0 = first) | sub |
| `MusicInitBank(song, subsong, bank)` | CPC 6128 only: `song AS UINTEGER` = &4000 (inside the bank); `bank AS UBYTE` 0-3 | sub |
| `MusicFrame()` | | sub |
| `MusicStop()` | | sub |
| `SfxInit(effects)` | `effects AS UINTEGER`: address of AKX effects data | sub |
| `SfxPlay(n, channel, invvol)` | `n AS UBYTE` 1 = first effect; `channel AS UBYTE` 0-2 (A, B, C); `invvol AS UBYTE` 0-16 inverted volume (0 full, 16 mute) | sub |
| `SfxStop(channel)` | `channel AS UBYTE` 0-2 | sub |
| `MusicAuto` | `DIM MusicAuto AS UBYTE` (default 1) | — |

The music player is Arkos Tracker 3.7's PlayerAkg (MIT), converted for Boriel. It plays
songs and sound effects through the AY, with each effect assigned to a channel. `MusicAuto`
controls the mode (read before `MusicInit`):

**Spectrum 128K support:** The same `music.bas` works on `--arch zx48k` (48K builds use `-D ZX48` to stub the music calls). On the 128K the player runs on the IM2 frame hook (like the CPC's frame hook) and chains to the ROM's IM1 routine, so FRAMES, PAUSE, INKEY$ keep working. The API is the same; `MusicInitBank` is CPC-only and has no effect on Spectrum.

* **Auto mode (MusicAuto = 1, the default):** `MusicInit` puts the player on the frame hook,
  so the song advances one tick per frame at 50 Hz, steady whatever the main loop does. It
  keeps playing through PRINT, WaitRetrace, firmware calls and long calculations. A program
  just calls `MusicInit` and forgets; `MusicFrame` is not needed. The player works in normal
  mode and in game mode (music plays even when the firmware stops). This is the recommended mode.

* **Manual mode (MusicAuto = 0):** `MusicInit` does not touch the frame hook. Call `MusicFrame`
  once per frame yourself (after `WaitRetrace(1)`), and the song advances at your loop's rate.
  The hook's single slot remains free for user code.

**MusicInit** starts a song. The song data is the address of AKG data (usually `@name` from
an aks2bas.py include). Subsong is 0 for the first of a multi-part song; the Arkos exporter
splits them. Calling it while a song plays restarts with the new one. It calls `SoundStop` first,
so the firmware sound manager is idle.

**MusicStop** silences the chip, takes the music off the frame hook (if it is the music's),
and stops any effect playing.

**SfxInit** gives the player a sound-effects bank (the address of AKX data from aks2bas.py
`--sfx`). Call it once, before the first `SfxPlay`; it can be called while a song plays.

**SfxPlay** plays effect n on a channel. Effects only advance while a song plays (so the
song's tempo is correct; an effects-only demo needs to play an empty song). `SfxStop` stops
the effect on a channel.

Cost: the player takes about 16 scanlines per frame (~4,200 T-states) with light test songs;
about 5 % of the CPU. It is always interrupt-driven on the frame hook (auto mode) or runs
with interrupts off during `MusicFrame` (manual mode), so every call runs under DI. In auto
mode a program that runs its own code on the hook must use manual mode instead (set `MusicAuto = 0`).

```basic
#include <music/music.bas>
#include "tune.bas"
#include "sfx.bas"

SfxInit(@sfx)
MusicInit(@tune, 0)                 ' auto mode, starts the tune

DO
    WaitRetrace(1)
    ScanKeys()
    IF KeyDown(KEY_A) THEN SfxPlay(1, 0, 0)  ' effect 1 on channel A at full volume
LOOP UNTIL KeyDown(KEY_ESC)

MusicStop()
```

### 7.10 Firmware sound (`cpc.bas`)

These queue notes on the firmware sound manager and return at once. The manager
plays from the interrupt handler. Each of the 3 channels (A = 1, B = 2, C = 4) has
a queue of 4 notes plus the one playing.

| Call | Parameters | Returns |
|---|---|---|
| `SoundQueue(channels, period, duration, volume, envelope)` | `channels AS UBYTE`; `period AS UINTEGER`; `duration AS UINTEGER`; `volume AS UBYTE`; `envelope AS UBYTE` | `UBYTE`: 1 queued, 0 queue full |
| `SoundFree(channel)` | `channel AS UBYTE`: 1, 2 or 4 | `UBYTE`: free queue slots, 0-4 |
| `SoundBusy(channel)` | `channel AS UBYTE`: 1, 2 or 4 | `UBYTE`: 1 if playing or has notes queued |
| `SoundEnvelope n, addr, sections` | `n AS UBYTE` 1-15; `addr AS UINTEGER`; `sections AS UBYTE` 1-5 | sub |
| `SoundStop` | | sub |

**SoundQueue** arguments:

| Argument | Meaning |
|---|---|
| `channels` | 1 = A, 2 = B, 4 = C, or OR'd to play the same note on several. Add 8, 16 or 32 for a rendezvous with A, B or C (the note waits until the other channel's note is also waiting for it, which keeps channels in step); add 128 to flush the queues first (the note starts at once). |
| `period` | The AY's tone period, 0-4095 (larger is clamped): `62500 / frequency in Hz`. Middle C (262 Hz) is 239, A 440 Hz is 142. Larger is lower. |
| `duration` | In 1/100 s, 1-32767. 0 = one run of the volume envelope. A negative value (65536 - n) repeats the envelope n times. |
| `volume` | Starting volume 0-15; a volume envelope, if any, then changes it. |
| `envelope` | Volume envelope number 1-15 (from `SoundEnvelope`), 0 = none. |

With several channels the return value is the last one's. If a channel's queue is
full nothing is queued; try again later.

**464 volume.** The 464's firmware (1.0) has volumes 0-7 only for a note with no
envelope (doubled into the AY's 0-15). `SoundQueue` converts so that every
model sounds the same: on the 464 volume v plays as the nearest even volume (15 as
14, 1 as 2). With an envelope, 0-15 works on every model.

**SoundEnvelope** defines volume envelope `n` from `sections * 3` bytes at `addr`.
Per section: step count (1-127), step size (signed, added to the volume per step,
volume stays 0-15), pause per step in 1/100 s (0-255). A section whose first byte
has bit 7 set is a hardware envelope instead (the AY's envelope generator: shape in
bits 0-3, then a 2-byte period). The data is copied: the array can be reused at
once. Example, a decay from 15 to 0 in 15 steps of 2/100 s:

```basic
DIM decay(2) AS UBYTE => {15, 255, 2}
SoundEnvelope 1, @decay(0), 1
```

**SoundStop** empties every queue and silences the chip (SOUND_RESET).

**SoundFree and SoundBusy** read the status of one channel (SOUND_CHECK).
`SoundBusy` is 1 if the channel is playing a note or has notes queued.

Cost: `SoundQueue` about 0.35 of a 300 Hz tick (1.2 ms). Notes that
play add to the interrupt load: 12.3 % idle, 13.9 % with three plain notes, 22.9 %
with three channels of envelopes stepping every 1/100 s.

```basic
DIM r AS UBYTE
SoundEnvelope 1, @decay(0), 1
IF SoundFree(1) > 2 THEN r = SoundQueue(1, 239, 20, 15, 1)    ' middle C, 0.2 s, envelope 1
```

### 7.11 Direct AY access (`cpc.bas`)

| Call | Parameters | Returns |
|---|---|---|
| `AyWrite reg, value` | `reg AS UBYTE` 0-15; `value AS UBYTE` | sub |
| `AyRead(reg)` | `reg AS UBYTE` 0-15 | `UBYTE`: bits a register does not implement read as 0 |

The AY sits behind the PPI. Both calls use the PPI directly with interrupts off for
the access and back on after (the firmware's keyboard scan shares the PPI). A write
takes about 58 us for the raw routine, plus the call and the `di`/`ei`. In register 7
(mixer) keep bits 6-7 clear: bit 6 makes the keyboard port an output and the keyboard
stops reading. Read [Sound ownership](#6-sound-ownership) first. Reading register 14
returns keyboard row 0.

```basic
SoundStop                       ' make the firmware's manager idle
AyWrite 7, %00111110            ' tone A on, everything else off
AyWrite 0, 239 BAND 255: AyWrite 1, 0
AyWrite 8, 15
```

### 7.12 Play (`play.bas`)

```basic
#include <play.bas>
Play "O4 V12 cdefgab", "O3 V10 cegc"
```

`Play(channel0 AS STRING, channel1 AS STRING = "", channel2 AS STRING = "")` plays MML
strings on the three AY channels, syntax-compatible with the Spectrum 128 Play
command. The commands it supports, its limits, and the changes made for the CPC
are listed in the header comment of `src/lib/arch/cpc/stdlib/play.bas` in the
compiler fork. Points that matter on the CPC:

* It turns interrupts off for the whole tune and back on at the end, so the
  keyboard, firmware clock and sound queue stop meanwhile, and it does not
  return until the tune is over.
* It calls SOUND_RESET once at the start (the sound manager is then idle). It
  owns the AY while it runs; see [Sound ownership](#6-sound-ownership).
* It is for the CPC's 1 MHz AY clock with the tempo calibrated to the CPC's CPU
  speed (within 0.6 % in tests).
* `--enable-break` is not supported with Play.
* It needs the default optimisation level (`-O2`); at level 1 or lower it does
  not work.

### 7.13 Font (`font.bas`)

| Call | Parameters | Returns |
|---|---|---|
| `SetFont(addr)` | `addr AS UINTEGER`: address of 768 bytes | sub |

`SetFont` replaces the glyphs of characters 32-127 with the 768 bytes at `addr`:
96 characters of 8 bytes, top row first, bit 7 the leftmost pixel (the Spectrum's
font format). Characters 128-255 keep their CPC shapes. Call it again to switch
fonts; `addr` may be anywhere in memory.

The first call takes 1792 bytes of heap for the firmware's character table (which
must be in &4000-&BFFF), installs it, and frees the 896-byte UDG table if the
program used `USR "a"` (UDGs defined before the call survive, and `USR "a"` keeps
working). A program that also uses `USR "a"` needs 2,688 bytes of free heap at its
first `SetFont`; if the heap is too small the call stops with error 3 (raise it
with `#pragma heap_size = 8192`). A program that does not include `font.bas` pays
nothing. `CHARS` is set to the table address minus 256, but `POKE CHARS` at
23606 does not work on the CPC; use `SetFont`.

```basic
#include <font.bas>
DIM myfont(767) AS UBYTE => { ... }
SetFont(@myfont(0))
```

### 7.14 Also in the cpc standard library

| Call | Notes |
|---|---|
| `POINT(x, y)` (`point.bas`) | The pen of the pixel at x, y in PLOT coordinates (bottom-left origin, mode pixels). 0 off the screen. Saves and restores the graphics cursor. |
| `SCREEN$(row, col)` (`screen.bas`) | The character at a text cell, as a one-character string, or `""`. |
| `INPUT(maxchars)` (`input.bas`) | Reads a line with the firmware cursor: `a$ = INPUT(20)`. |

## 10. CPC Plus (cpcplus)

`lib/cpcplus` drives the CPC Plus / GX4000 ASIC: 16 hardware sprites, the
12-bit palette (4,096 colours), soft scroll and split screen, raster
interrupts (bare mode only) and DMA sound. It works in firmware mode and in
bare-metal mode (`-D CPC_BAREMETAL`). On a 464/664/6128 every call does
nothing and changes nothing; `PlusAvailable()` tells a program which machine
it is on. The first call probes the ASIC and unlocks it (`PlusLock()` locks
it again). The full reference, with every rule, is the header of
`lib/cpcplus/cpcplus.bas`.

```basic
#include <cpcplus/cpcplus.bas>
```

### Calls

| Call | What it does |
|---|---|
| `PlusAvailable()` | 1 on a Plus or GX4000, 0 on a 464/664/6128 |
| `PlusUnlock()`, `PlusLock()` | unlock (the calls do it the first time) / lock again (bare mode: ends raster interrupts first) |
| `PlusPeek(addr)`, `PlusPoke(addr, value)` | one byte of the ASIC page (&4000-&7FFF), paging done for you |
| `PlusPokeBlock(dest, src, count)` | a block from RAM into the ASIC page in one window; cut at &7FFF |
| `PlusPageIn()`, `PlusPageOut()` | hand the ASIC page to the program (the only calls that still reserve &4000-&7FFF) |
| `SetPalette12(pen, rgb)` | pen 0-15 gets `rgb` = `&H0RGB` (red, green, blue 0-15 each) |
| `SetBorder12(rgb)` | the border |
| `GetPalette12(entry)` | colour of entry 0-31 (16 = border, 17-31 = sprite colours 1-15) |
| `SetPalette12Block(addr, first, count)` | count colours (two bytes each, as `img2cpc.py --plus-palette` writes) into entries first.. |
| `SpritePalette(addr)` | sprite colours 1-15 from 30 bytes (`img2cpc.py --plus-sprite`'s `NAME_pal`) |
| `SpriteColour(n, rgb)` | one sprite colour, n = 1-15 |
| `SpriteSetImage(n, addr)` | sprite n (0-15): 256 bytes, one pixel per byte, 0 = transparent, 1-15 = sprite colour |
| `SpriteSetImagePacked(n, addr)` | the same from 128 bytes, two pixels per byte, left pixel in the high nibble (needs about 270 bytes of stack) |
| `SpriteMove(n, x, y)` | position (see Coordinates); values outside the ASIC's range are clamped |
| `SpriteMoveBlock(first, count, addr)` | positions of several sprites from a table of INTEGER pairs (x0, y0, x1, y1, ...), one window, **not clamped** (x -256..767, y -256..255) |
| `SpriteMag(n, magx, magy)` | magnification 1, 2 or 4; 0 hides the sprite |
| `SpriteHide(n)`, `SpritesHideAll()` | hide one / all 16 |
| `ScrollFine(dx, dy)` | soft scroll: dx 0-15 mode-2 pixels right, dy 0-7 lines up |
| `ScrollBorder(flag)` | 1 widens the left border by 16 mode-2 pixels (hides the scroll's left edge) |
| `SplitScreen(line, addr)`, `SplitScreenCrtc(line, crtc)`, `SplitOff()` | from scan line `line` (1-255) show the screen at byte address `addr` (or CRTC word R12 * 256 + R13); off |
| `RasterIntAt(line, handler)`, `RasterIntOff(line)`, `RasterIntMove(old, new)`, `RasterIntClear()` | bare mode only: see Raster interrupts |
| `DmaStart(channel, addr)`, `DmaStop(channel)`, `DmaActive()`, `DmaPrescaler(channel, value)`, `DmaAlign(addr)` | DMA sound: see DMA sound |

**Coordinates.** x is in mode-2 pixels from the left edge of the 640-pixel
picture, y in lines from the top of the 200-line picture, for the sprite's
top-left corner. A sprite is 16x16 pixels; one sprite pixel is 1, 2 or 4
mode-2 pixels wide and 1, 2 or 4 lines high at magnification 1, 2, 4. Where
sprites overlap, the lower-numbered one is in front (sprite 0 over sprite
15). All 16 sprites share the 15 sprite colours (palette entries 17-31).

### Cost

Measured on Caprice32 and CPCEC, bare / firmware mode (firmware-mode figures
include the firmware's own interrupts). Net microseconds on top of BASIC's
own call overhead (about 93 us):

| Call | Cost |
|---|---|
| `SetPalette12`, `SetBorder12` | 93 / 131 us |
| `SpriteColour` | 106 / 131 us |
| `SpriteMove` (in range) | 106 / 133 us |
| `SpriteMoveBlock` | 130 us + 28 us a sprite (8 sprites 360 us; 8 `SpriteMove` calls cost 850) |
| `SetPalette12Block`, 16 colours | about 410 us |
| `ScrollFine` / `SpriteMag` | about 150 / 190 us |

Pictures and blocks, milliseconds a call including the call overhead:
`SpriteSetImage` 1.8 / 2.0 (3.9 / 4.3 from a source in &4000-&7FFF),
`SpriteSetImagePacked` 4.7 / 5.2, `PlusPokeBlock` 0.85 / 0.93 for 88 bytes
and 1.85 / 2.05 for 256. A block costs 6 us a byte (an LDIR byte is 24
T-states on the CPC) plus about 0.3 ms.

### Rules to know

- **Set the 12-bit palette again after `Mode()`.** In firmware mode the
  firmware rewrites all 17 inks every 10 frames, which would undo 12-bit
  pen and border colours; the library stops that refresh on the first pen
  or border call, and `Mode()` restarts it and resets the inks. Bare mode
  has no refresh. Sprite colours are never touched by the firmware.
- **Call `SpritesHideAll()` before END** (and `ScrollFine(0, 0)`,
  `SplitOff()`): sprites, scroll and split are ASIC state and survive the
  reset.
- **No 16 KB limit.** The few instructions that run while the ASIC page
  replaces &4000-&7FFF are kept in the runtime's private block (firmware
  layout &9E00, bare &BC00), so a program's code and data may lie anywhere.
  Only a program that uses `PlusPageIn`/`PlusPageOut` must end below &4000.
- **Soft scroll and split screen:** whole bytes still move with the CRTC
  start address (R12/R13, or cpcbuild's FlipBuffer); the soft scroll adds to
  it. A vertical soft scroll shows the next character row's first lines at
  the bottom of each row, so keep a spare row of data below the picture.
  Split on a multiple of 8 lines for a clean split. The split address is
  independent of the double buffer's R12/R13.

### Raster interrupts (bare mode only)

The ASIC's programmable raster interrupt stops the CPC's normal six
interrupts per frame, which the firmware needs, so `RasterIntAt` and friends
work only with `-D CPC_BAREMETAL`; a firmware build that uses them fails with
an undefined label naming bare mode.

`RasterIntAt(line, handler)` runs a machine-code routine (ending in RET) once a
frame at scan line `line` (1-255), with interrupts off and all registers
saved. Up to 15 lines; the library adds a frame entry at line 243 that keeps
`Frames()`, PAUSE, BEEP and the frame hook at 50 Hz. A handler must not call
the firmware or change the table. `RasterIntMove(old, new)` moves a line
keeping its handler (0.19 ms in place, about 0.5 ms across other lines,
against 1.0 ms for `RasterIntOff` + `RasterIntAt`) and returns 1 if moved;
call it in the vertical blank after the frame tick or from a frame hook,
never from a handler.

**Timing.** A handler's first instruction runs about 620 T-states (2.4 lines)
after the interrupt, plus up to 23 for the instruction the Z80 finishes
first: ask for the line three lines before the one you want. The interrupt
handler needs about 300 T-states after the handler returns, so lines closer
together than (920 + handler T-states) / 256 lines are delayed.

**Steady splits: wait in HALT.** The Z80 finishes its current instruction
before taking the interrupt, so if the main program is busy, a colour change
jitters sideways by up to that instruction's length. Keep the main program
waiting in HALT while the lines go by (PAUSE and WaitVsync do; a game draws,
then waits for the next frame).

**Fast path for handlers.** The calls above are too slow inside a handler.
From an ASM block, `call .core.PlusHandlerIn`, store straight to the ASIC
(`ld (&6400), de` sets pen 0 with E = red << 4 | blue, D = green; `ld
(&6420), de` the border; the scroll register is &6804), then `call
.core.PlusHandlerOut`: 49 T-states each, about 150 T-states with two stores.
Between them &4000-&7FFF is the ASIC, so the handler's code, data and stack
must lie outside it. With `#require "cpcplus/plushandler.asm"` the entries
`PlusHandlerSetColourRaw` (155 T-states), `PlusHandlerSetColour`,
`PlusHandlerPoke` and `PlusHandlerScroll` do their own paging and have no
placement rule. Use them only on a Plus (`PlusAvailable()` = 1), after the
ASIC is unlocked.

### DMA sound

Each of the three channels fetches one 16-bit instruction a scan line from a
list in RAM and plays the AY by itself, with no CPU time. `DmaStart(channel,
addr)` returns 1, or 0 if refused (channel not 0-2, an odd address, or no
ASIC). List words: `DMA_LOAD(reg, value)` (write an AY register),
`DMA_PAUSE(n)` (wait n * (prescaler + 1) lines), `DMA_REPEAT(n)` (the next
instruction starts a loop run n more times), `DMA_LOOP`, `DMA_NOP`,
`DMA_STOP`; don't use `DMA_INT`. A list may lie anywhere in the first 64 KB
at an even address (`DIM list(n) AS UINTEGER` one word longer than needed,
started at `DmaAlign(@list(0))`). While DMA runs, nothing else may write the
same AY registers (music player, BEEP, Play, AyWrite; in firmware mode no
firmware sounds).

### Tools

- `img2cpc.py --plus-sprite [--packed]` turns 16x16 cells of a PNG into
  sprite data and a 15-colour sprite palette (error if more than 15 colours,
  unless `--palette` gives them); `--plus-palette` gives 16 pen colours.
- `mkcpr.py prog.bin -o game.cpr` builds a cartridge from a bare program
  (`-D CPC_BAREMETAL -D CPC_OWNFONT`; a cartridge has no firmware font). The
  origin is read from the `.map` next to the binary, or given with
  `--load`. A boot stub copies the program into RAM; it must lie below &C000.
- `cpcrun.py prog.bas --model plus [--bare]` runs on a 6128 Plus in
  Caprice32; `cpcrun.py --cpr game.cpr` runs a cartridge; `--emu cpcec` uses
  CPCEC instead (`tools/cpcec/fetch_build.sh`, or `make cpcec`).

**Emulators.** Caprice32 draws all sprites once per frame from their final
registers, so it cannot show sprites repositioned mid-frame (multiplexing);
CPCEC draws them line by line and is the reference for that. CPCEC shows
12-bit colours brighter than Caprice32. Plus screenshot goldens are kept per
emulator.

### Examples

- **examples/plusdemo.bas**: the Plus feature demo (bare mode): 8 bouncing
  hardware sprites at several sizes, 12-bit colour cycling, 14 steady raster
  bars, a split screen with a smooth-scrolling landscape, and a DMA tune.
  Build the cartridge with `sh examples/plusdemo/build.sh`.
- **Starfall Plus** (games/shooter, `build_plus.sh`): the ship, bullets,
  bombs, diver and explosions are hardware sprites on disc (`RUN"PLUS`) and
  cartridge; the cartridge also multiplexes the 18-alien formation onto six
  sprites with raster handlers. See games/shooter/README.md.

## 11. Performance tips

All figures are measured in Caprice32 unless marked otherwise. The CPC's Z80 runs at 4 MHz but every instruction takes a whole
number of microseconds, so counts here are "effective" T-states; a frame (20 ms)
is 80,000 of them. **Interrupts are always on in compiled code** and the firmware's
300 Hz handler takes about 12.3 % of the CPU on its own (about 2 % of that is the
runtime's front-end; calibrated with a busy loop), more when sound envelopes play
(13.9 % with three plain notes, 22.9 % with three channels of envelopes). Budget
for about 88 % of the machine, less with music.

**Game mode.** In game mode the firmware's interrupt work stops outside firmware calls,
cutting the baseline from 12.3 % to about 1-2 %. The music player (if running) takes
about 5 % on top, so game mode with music leaves about 92 % free vs 80 % in normal mode
with music. Measured with bounce.bas: silent 25.0 updates/s (normal), 25.0 (game mode);
with effects only 19.6 (normal), 25.0 (game mode); with music and effects 20.0 (normal),
25.0 (game mode).

**Array indexing.** An array element with a variable index calls the compiler's
general array routine, a few hundred T-states per access, whatever the optimisation
level. `PEEK`/`POKE` through a pointer is only a few instructions. For hot loops,
keep per-object state in a small record of bytes in one array and reach it through
a pointer:

```basic
DIM st(NBALLS * 16 - 1) AS UBYTE
p = @st(0)
x = PEEK(p + 0) + PEEK(p + 2)       ' fields at fixed offsets
POKE p + 0, x
p = p + 16                          ' next object
```

In bounce.bas moving the ball state from indexed arrays to 16-byte records took the
rate from 12.5 to 20 updates a second.

**Arithmetic.** Prefer shifts and 8-bit variables to divisions, MOD and 16-bit
multiplies in inner loops. Use integers or fixed point, not FLOAT (floating point is
about three times slower than Locomotive BASIC; integer code is 12 to 52 times
faster). `-O2` and `-O3` made no difference to bounce.bas.

**Erase with TileRestore.** To erase a sprite on a tiled background, use one
`TileRestore(@map, mapw, x, y, w, h)` call instead of looping `DoTile8` in BASIC.
In bounce.bas replacing the BASIC erase loops with `TileRestore` took the rate from
10.5 to 12.5 updates a second, and its short path (rectangle on the screen, no
scroll offset) from 20 to 25. A `DoTile8` call from BASIC costs about 2.3k including
the call; a redrawn tile inside `TileMap` costs about 0.8-1.2k.

**Fast paths need an unscrolled screen.** Sprites of width 1, 2, 4 or 8 bytes that
are not clipped at a side, tile maps and rectangle fills use unrolled loops when no
screen row can wrap past the end of its 2 KB block, which holds when the hardware
scroll offset is 48 or less. Scrolled text leaves a larger offset, and the slower
generic paths are used until `Mode` resets it. Keep text from scrolling (or print
before drawing) in programs that need speed.

**Sprites.** The 64 bytes of a 4 x 16 sprite cost 1,280 T-states in `LDI` alone
(an `LDI` is 20 T on the CPC), so a 16 x 16 mode-0 sprite cannot go much below
3,700 T. Fewer, narrower sprites are the lever: use widths of 1, 2, 4 or 8 bytes,
avoid partial clipping at the sides where you can, and use `PutSprite` instead of
`PutSpriteMasked` (about 30 % cheaper) for objects that cover a full rectangle.
For 8 masked 16 x 16 sprites per frame the routine time is about 42k T of the
66k including the BASIC call overhead.

**Gate calls.** Every firmware call costs about 220 T-states more than the
routine. `Mode`, `SetInk`, `SetPalette`, `WaitRetrace`, `FlipBuffer` and the sound
calls each make at least one; the tile, sprite, fill and keyboard routines make
none. Do palette work outside the inner loop.

**ClearScreen** takes about 25 ms (a frame and a quarter) and holds interrupts off
only in short chunks. Clear only the area you need with `FillRect`, or redraw the
background with `TileMap`, when the frame budget is tight.

**Double buffering costs memory and one frame of latency**: code and data must fit
in 12 KB, and `FlipBuffer` ends the frame at the flyback. The loop of bounce.bas
runs at 25 updates a second (every other frame) with 8 balls.

**Sound costs CPU.** In bounce.bas with 8 balls, silent: 25.0 updates a second;
with wall blips: 22.3; with blips and a two-channel tune: 20.0 (19.8 on the 464).
`SoundQueue` itself is cheap (about 1.2 ms), the cost is the firmware's interrupt
work. Top the queues up every few frames instead of every frame, and leave out
envelopes that step every 1/100 s if the frame budget matters.

**Starfall reference** (games/shooter, 25 Hz logic, CPC 6128 with music and effects in game mode):
25.0 steps/s, all CPU available elsewhere. Single-buffered CPC 464: about 25.0 steps/s with about 30 %
spare (no pacing). Spectrum 128K: 24.2 steps/s (about 20 of 250 steps overrun at formation moves; the Arkos
player costs about 0.2 frame per step). See games/shooter/README.md for all four builds' performance.

**bounce.bas reference** (the demo in `examples/`, 8 masked balls over a tiled
mode-0 background, double buffered): about 10 updates a second at first, about 12
with unrolled sprite and tile routines, 25 with `TileRestore` and pointer records.
Before those changes, about 103k T per iteration were the demo's own BASIC, about
66k the 8 masked sprites (42k inside the routine), and each ball's erase 4-6
`DoTile8` calls at about 2.3k each. Build switches: `-D BALLS=n` (1-8, default 8),
`-D NOMUSIC` (effects only), `-D NOSFX` (music only), `-D NOSOUND` (silent),
`-D GAMEMODE` (game mode on), `-D FWSOUND` (firmware sound instead of music player),
`-D BENCH` (runs 250 updates and prints the rate), `-D SHOT=n` (n updates then screenshot).

**Other things that cost time or memory.**

* Strings built in a loop can overflow the default 4.7 KB heap (error 9 or a reset);
  raise it with `-H` or `#pragma heap_size` and keep per-frame text out of the
  hot loop.
* A `FOR` loop with a `UBYTE` counter that runs to 255 never ends.
* `AND` and `OR` are logical operators in Boriel; use `BAND`, `BOR` and `BXOR` for
  bits.
