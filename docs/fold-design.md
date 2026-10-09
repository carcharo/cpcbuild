# Folding Starfall's drawing routines into the libraries

Follow-up (b)/(b2) from the Phase 5c pick-up list: move the sprite, text and
tile routines that Starfall carries in its platform layers into reusable
library modules, then rewrite the layers on top of them so the game is mostly
BASIC on every platform. Status: design, 2026-10-09.

Decided with the user (2026-10-09): per-routine `#require` in the compiler
(section 1, not the `.bas` split); the Spectrum engine goes to
`lib/zxbuild/`; stop for review after the library modules (steps 1-5),
before Starfall is rewritten on them (steps 6-7).

## Where we start (measured 2026-10-09)

- CPC layer (`games/shooter/platform_cpc.bas`): one asm block of about
  1,600 bytes (`SF_SPR` &133D to `SF_END` &197D in the 6128 map, about
  400 of them lists and buffers). It draws 4x8 and 1x4 byte sprites by OR
  onto a black box, erases by clearing the box, keeps one sprite list per
  screen (double-buffered) or erases in slot order (464, single-buffered),
  draws 5x7 glyphs (7 bytes each) and 32-byte tiles, and queues text so it
  reaches both screens. The rest (HUD diffing, stars, playfield clear, the
  kind table) is Starfall-specific.
- Spectrum layer (`platform_zx.bas`, `platform_zx_draw.asm`): a 16x8
  pre-shifted OR sprite engine with background save and attribute
  colouring, 28 sprites a frame, about 4.7K T-states a sprite; the sync
  step skips sprites that are unchanged since the frame before. The fixed
  data lives at &DB00-&E830 (bank 7 on 128K).
- Plus layer: reuses the CPC engine for the formation, `lib/cpcplus` for
  the hardware sprites. Not folded here; it follows whatever the CPC layer
  becomes.
- Room: 6128 firmware build ends &39E8, **1,560 bytes** below &4000; bare
  6128 1,098 bytes; Spectrum 128K **635 bytes** below &C000.
- The library: each `.bas` module compiles only the wrappers a program
  calls, but its `#require "cpcbuild/x.asm"` pulls in the whole asm file
  (`#require` is recorded at parse time, `zxbparser.py`
  `preproc_line_require`). Measured: `PutSprite` alone adds 1,643 bytes
  (sprite.asm includes fill.asm), `DoTile8` alone 1,290. That is why the
  game couldn't use them.

## Goals and the milestone

1. Library modules that do what the game layers do, at the same speed, and
   that cost a program only the routines it calls.
2. Starfall rewritten on them: the platform layers become BASIC calls, plus
   only what is truly game-specific.

Milestone (all must hold):
- `make test-games` (102 logic checks, screenshot goldens for all four CPC
  builds) and `make test-zx` pass with the goldens **unchanged**; Starfall
  Plus `make test-plus` / `test-cpcec` too.
- Speeds no worse than today: CPC 6128 25.0, 464 25.0, Spectrum 48K 25.0,
  128K 24.2 steps/s (`games/shooter/tests/bench.sh`).
- 6128 firmware and bare builds still end below &4000; Spectrum 128K below
  &C000.
- New modules documented in docs/library.md with measured costs (the main
  model writes those sections), and covered by screenshot tests.

## The design

### 1. Per-routine linking: `#require` inside a SUB/FUNCTION (compiler)

A `#require` line inside a SUB or FUNCTION body is attached to that routine
and only takes effect if the routine is compiled in (not dropped as never
called). At file level it keeps today's behaviour, so upstream libraries
are unaffected. Then the library splits its big asm files into small ones
(one or a few routines each), and each wrapper requires exactly what it
needs. `#include once` between asm files keeps working for shared pieces.

This is the general fix for "slimmer library modules", and every existing
module gets it, not only the new ones. Alternative if it turns out awkward
in the compiler: split the `.bas` files instead (`tiles.bas` into
`tile8.bas` + `tilemap.bas`), which needs no compiler change but makes
users choose files.

### 2. The asm split (cpcbuild)

- `sprite.asm`: the clipper's dependency on `fill.asm` moves into a small
  shared file, so `PutSprite` doesn't pull in `FillRect`.
- `tiles.asm`: `DoTile8`/`DoTile16` core (tile pointer, cell address,
  draw) apart from `TileMap`, `TileMapPart`, `TileRestore`.
- Target: `DoTile8` alone well under 400 bytes; numbers measured and
  written into library.md.

### 3. New CPC module: `cpcbuild/spritelist.bas` (sprites on a plain background)

For games whose background behind sprites is one colour: a sprite is drawn
by OR onto the background and erased by filling its box with the background
pen byte, so there is no mask and no save buffer. About 5 times cheaper
than `PutSpriteMasked` + `TileRestore`, per the game's own comparison.

- Sprite data: screen bytes, row-major, pixels only (transparent = pen 0),
  the same layout as `PutSprite`.
- Box sizes: any width 1-8 bytes and height 1-255 lines, with unrolled
  fast paths for widths 1, 2 and 4 (the game's 4x8 and 1x4).
- The list: entries of screen address and size, capacity set by the
  program (`#define SPRLIST_MAX` before the include, default 40).
- Double-buffered (with `EnableDoubleBuffer`): `SprListBegin` erases the
  hidden screen's list from two frames ago; `SprListDraw(x, y, w, h, spr)`
  appends and draws. Single-buffered: each call erases the same slot's
  previous sprite just before drawing (flyback order), and
  `SprListEnd` erases the slots not reused this frame.
- `SprListClear` forgets both lists (after a screen clear).
- No clipping by default (fastest); optional clipping to a rectangle set
  with `SprListClip(x, y, w, h)`, compiled in only if called.

As built (2026-10-09, untracked until the stage gate): `SprListBegin`,
`SprListDraw(x, y, w, h, spr)` (UBYTE arguments), `SprListEnd`,
`SprListReset` (not `SprListClear`), `SprListPaper(b)`; no clipping (a
sprite must lie wholly on the screen). Routine cost as the game's (4x8
draw + erase 3,004 T against the game's 2,940; 1x4 719 both); from BASIC
about 1,100 T more per call. Measured from BASIC, erase + draw is about
1.6x cheaper than `FillRect` + `PutSprite`; the game's "5 times cheaper
than PutSpriteMasked + TileRestore" was not re-measured (TileRestore not
benched). Size: 1,005 bytes for Begin + Draw + End, 320 of them the lists.

### 4. New CPC module: `cpcbuild/text.bas` (compact bitmap font)

- Font: one byte per pixel row, up to 8 rows, the leftmost pixel in a
  chosen bit (Starfall's: 7 rows, bit 4, ASCII 45-90 = 322 bytes); set
  with `TextFont(addr, first, last, rows, width)`.
- `TextPen(ink, paper)`; `TextAt(col, row, s$)` draws in character cells
  (mode 0: 4 bytes x 8 lines a cell; mode 1: 2 bytes x 8 lines), on the
  screen being drawn.
- `TextAtBoth(col, row, s$)`: queues the text so it reaches both screens
  when double-buffered (drawn by `SprListBegin` or a `TextFlush` call),
  replacing the game's text queue.
- Mode 0 first (what Starfall needs); mode 1 in the same module if it
  costs little, otherwise later.

As built: `TextFont(addr, first, rows [, last])` (bit 7 leftmost, 8
pixels wide at most; `last` lets characters above the font draw blank),
`TextPen(inkpen, paperpen)`, `TextAt`, `TextAtBoth`, `TextFlush` (the
program calls it after `FlipBuffer`). Modes 0 and 1 (mode 1 ~110 bytes).
A mode 0 glyph ~2,600 T against the game's `SF_GLY` ~2,950; each `TextAt`
call costs ~2,900 T for the compiler's string copy. Starfall's font
matches the game's pixels when shifted left by 2 (the game leaves a
one-pixel left margin). Size: `TextAt` ~825 bytes plus ~390 of string
support; `TextAtBoth`/`TextFlush` ~350 more, 160 of them the queue.

### 5. New Spectrum library: `lib/zxbuild/sprites.bas`

The Starfall Spectrum engine made generic: 16x8 and 8x4 pre-shifted OR
sprites with background save and optional attribute colour per image,
double-buffered on 128K (screens 5 and 7), single on 48K, the "skip
unchanged sprites" sync. Images are built from the source art at start
(the game's `PzBuild` moves into the library). Buffers stay at a fixed
address the program chooses (default &DB00, bank 7 on 128K). The name
mirrors `lib/cpcbuild`; `lib/music` stays the shared cross-platform
library.

As built: `SpritesInit(double)`, `SpriteImage(n, src, wide, attr)`,
`SpritesBegin`, `SpriteAdd(n, x, y)`, `SpritesSync`, `SpritesFlip`,
`SpritesReset`, plus `SpritesDone` (back to screen 5, as the game's
`PlatEnd`) and `SpritesScreen()`. Narrow images are 4x4 pixels (Starfall's
shots are 2 pixels wide), not 8x4. Data area 84 x ZXSPR_MAX + 44 x
ZXSPR_IMAGES bytes (&BF0 by default, &DB00-&E6F0). Per sprite, erase +
draw + attributes ~3,300 T (wide, x a multiple of 8), ~3,900 (x = 4 mod 8),
~2,200 narrow; an unchanged sprite ~270. It does not use Boriel's
`cb/maskedsprites.bas`: its `CheckMemoryPaging` and `SetDrawingScreen7`
are FASTCALL routines with locals but no stack frame of their own, and
they overwrote the caller's locals when called from `SpritesInit`
(the agent's minimal reproduction; Starfall's `PlatInit` calls them and
survives by luck).

### 6. Starfall on the libraries

- CPC: `PlatSprite` becomes a few lines of BASIC around `SprListDraw` (the
  kind-to-frame table and coordinate mapping); tiles through `DoTile8`;
  text through `text.bas`; the playfield clear through `FillRect`. HUD
  diffing and stars stay in the game, in BASIC unless measuring shows they
  need asm.
- Spectrum: the same on `zxbuild/sprites.bas`.
- Plus: keeps its hardware-sprite code; its software fallback uses the
  CPC library modules.
- The risk is size: library code is more general and BASIC wrappers cost
  call overhead. The 1,560 bytes of headroom on the 6128 is the budget. If
  it runs out, the rule is: the library stays general, and the game keeps a
  small asm helper for the hottest path, with the reason in a comment.

## Order and who does what

| Step | Work | Who |
|---|---|---|
| 0 | Compiler warning fix (W150/W190/W170): **done**, zxbasic a7c325e6 | sonnet agent; main model reviewed, committed |
| 1 | `#require` inside SUB/FUNCTION (compiler, tests): **done**, zxbasic 762456ed | sonnet agent (own worktree); main model reviewed, merged |
| 2 | Split sprite/tiles/fill asm; measure sizes; existing goldens unchanged: **done** (pure move: the same 2,096 instruction lines) | sonnet agent; main model checked |
| 3 | `spritelist.bas` from the game's `SF_DRAW*`/`SF_ERASE*`/`SF_BEGIN`/`SF_FEND`/`SF_SPRITE`, with screen tests: **done** | sonnet agent |
| 4 | `text.bas` from `SF_GLY`/`SF_TEXTADD`/`SF_TEXTDRAW`, with screen tests: **done** | sonnet agent |
| 5 | `zxbuild/sprites.bas` from `platform_zx_draw.asm` + `PzBuild`, with zx screen tests: **done** | sonnet agent |
| 6 | Starfall CPC layer on the libraries; then Plus fallback | sonnet agent; main model checks goldens, speed, size |
| 7 | Starfall Spectrum layer on `zxbuild` | sonnet agent; main model checks as above |
| 8 | library.md sections, notes, README: library.md 7.15, 7.16, 12 and the size table **done** | main model (from the headers and measurements) |

The main model writes each agent spec, reviews every diff, runs the
milestone checks itself, and commits. Agents don't commit, never run
`git stash`/`checkout`/`reset`/`clean`, and each gets its own scratchpad
subfolder.

## Stage gate (2026-10-09): the size budget for step 6

The 6128 Starfall now has 1,649 bytes below &4000 (it gained 89 from the
split). Its own engine is about 1,600 bytes, so about 3,250 bytes are free
for the library routines plus the BASIC that replaces the engine. The
library routines it would call (measured): SprList 1,005, TextAt +
TextAtBoth/TextFlush about 1,220 (the game already has string support),
DoTile8 485, FillRect 349: about 3,060. That leaves about 190 bytes for the
BASIC replacing the HUD diffing, stars, kind table and playfield clear,
which is not enough. Ways to make room, for the user to choose at the gate:
smaller lists and queue (`SPRLIST_MAX 40` costs 320 bytes where the game
used 240; `TEXT_QUEUE` 160), a playfield clear by `SprListPaper`-style
boxes instead of `FillRect`, keeping the HUD and stars as a small game asm
helper (allowed by section 6), or moving more of the game's data out of
the first 16 KB.
