# Phase 4c design: the `cpcbuild` graphics library

**Note:** statements about interrupts being off outside firmware calls predate Phase 4d (2026-10-02); since Phase 4d, compiled code runs with interrupts always on (cpc-port-notes.md §15).

Decided 2026-10-01: all open decisions below were taken as recommended (notes.md). The plan's Phase 4c, with the 2026-10-01 decision to
write our own routines (MIT, clean-room) instead of extracting CPCtelera's
(LGPL v3). Open decisions are marked **Q-4c.n** and collected at the end.

## Scope

Firmware-free routines that write screen memory directly, for speed. The
text layer (PRINT, INK/PAPER) and the Phase 4a firmware graphics (PLOT,
DRAW, CIRCLE) stay as they are and can be mixed with this library.

| Area | Routines |
|---|---|
| Screen addressing | pixel/character position to screen byte address, next line down |
| Sprites | mode 0 and mode 1, plain (overwrite) and masked (transparent), byte-aligned x |
| Tiles | put one tile (8x8 and 16x16? see Q-4c.4), draw a tilemap region |
| Fill | rectangle fill with a pen (byte-aligned) |
| Keyboard | scan the whole 10x8 matrix into a buffer, test a key, test several keys |
| Double buffering | draw to a hidden screen, swap at vsync (Q-4c.1) |
| Palette | `SetPalette` from a DATA list (firmware SCR_SET_INK, see below) |

Where it lives: `src/lib/arch/cpc/stdlib/cpcbuild/` (BASIC wrappers, one
`.bas` per area so programs only link what they use) and
`src/lib/arch/cpc/runtime/cpcbuild/` (the asm). Licence: MIT, like Boriel's
own runtime, so compiled games stay closed-source-friendly.

## Clean-room rule

Whoever writes these routines does not read CPCtelera's source (or any
other LGPL/GPL CPC library). Allowed inputs: the CPC hardware documentation
(cpcwiki.eu pages on the gate array, CRTC, PPI and screen layout), the
Firmware Guide, and general Z80 technique. Each file's header says so.

## Facts the routines depend on

- Screen at &C000 (16 KB). Byte address of pixel row y (0 = top), byte
  column b: `base + (y AND 7) * &800 + (y >> 3) * 80 + b`, plus the CRTC
  offset (below). 80 bytes per line in every mode: mode 0 = 2 pixels per
  byte, mode 1 = 4, mode 2 = 8, with interleaved bit layouts.
- **Hardware scroll.** When the firmware scrolls text in a full-screen
  window it moves the CRTC start address (SCR_HW_ROLL) instead of copying
  memory, so after a scroll &C000 is no longer the top-left byte. The
  library must add the current offset (SCR_GET_LOCATION, &BC0B: base and
  offset) or the program must not let text scroll. Plan: read it into a
  library variable at `ScreenInit` and on every `WaitFrame`/`SwapScreen`,
  and wrap addresses within the 2 KB line blocks (Q-4c.3).
- Coordinates: the library uses **top-left origin, y down, x in bytes**
  for speed (sprite routines), unlike PLOT's bottom-left mode pixels. A
  helper converts. (Q-4c.2)
- Palette and mode: through the firmware (SCR_SET_INK, SCR_SET_MODE), not
  the gate array directly, so the firmware's own idea of the palette stays
  right (cpc-port-notes §6.6). Speed doesn't matter for these.
- Interrupts are off outside gate calls, so direct screen writes and
  direct PPI keyboard reads can't be disturbed by the firmware's interrupt
  handler. The keyboard scan must leave the PPI the way the firmware
  expects (port A input, AY inactive on port C).
- 464 and 6128: only main 64K RAM and hardware every model has.

## Proposed API (names to confirm, Q-4c.5)

NextBuild (Spectrum Next) uses names like `UpdateSprite`, `DoTileBank16`,
`CLS256`, `WaitRetrace`. Proposed CPC equivalents:

```basic
ScreenInit()                              ' read mode and scroll offset
WaitRetrace()                             ' wait for the frame flyback
PutSprite(x, y, w, h, @data)              ' plain, x in bytes
PutSpriteMasked(x, y, w, h, @data)        ' data: mask,pixels byte pairs
PutTile(col, row, tile, @tileset)         ' 8x8 cells? (Q-4c.4)
DrawMap(col, row, w, h, @map, @tileset)
FillRect(x, y, w, h, pen)                 ' x, w in bytes
ScanKeys()                                ' read the whole matrix
KeyDown(key) AS UBYTE                     ' key = firmware key number
SetPalette(@colours, count)
SwapScreen()                              ' double buffering (Q-4c.1)
```

## Testing

Each routine gets a conformance program in `cpcbuild/tests/conformance/`
that draws and reads pixels back with POINT, on the 6128 and the 464, plus
a speed figure (T-states per 16x16 sprite) in the notes.

## Open decisions

- **Q-4c.1 Double buffering memory.** The CRTC can only show a screen at
  &0000, &4000, &8000 or &C000 of main RAM. A second screen at &4000 takes
  16 KB of the program area (code would have to fit &1000-&3FFF, 12 KB);
  at &8000 it collides with the heap and runtime block. Options: (a) back
  buffer at &4000, opt-in, with a build check that the code fits below it;
  (b) no hardware double buffering, just draw during the flyback;
  (c) decide later.
- **Q-4c.2 Coordinates.** Sprite/tile routines in bytes from the top-left
  (fast, standard on the CPC) vs mode pixels from the bottom-left (same as
  PLOT, but slower and odd for sprites).
- **Q-4c.3 Text scrolling.** Track the firmware's hardware-scroll offset
  (a few hundred T-states per frame) vs require programs using the library
  to stop text from scrolling (and reset the offset at `ScreenInit`).
- **Q-4c.4 Tile sizes.** 8x8 only at first, or 8x8 and 16x16? Mode 0 or
  mode 1 tiles first?
- **Q-4c.5 API names.** NextBuild-style names as above, or CPC-style ones
  (e.g. `DrawSprite`)? Same names on the Spectrum later would let one game
  source build for both.
- Also pending from notes.md: Q15 (INKEY$ model), Q18 (keys.bas on the new
  keyboard scan), Q19 (664/6128-only extras).
