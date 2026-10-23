' ----------------------------------------------------------------
' finetiles.bas -- cpcbuild demo (Amstrad CPC, mode 0)
'
' Narrow tiles: SetTileWidth(2) makes a tile 4 x 8 pixels instead of the
' mode 0 default of 8 x 8, so the screen is 40 x 25 cells and the level
' (a brick border, grass and dirt platforms, ladders, stars) has a finer
' grain than 8-pixel tiles allow. Four masked 16 x 16 sprites (a gem, a
' blob and a ghost, the gem again) move over it, double-buffered,
' each erased with one TileRestore call and drawn with one PutSpriteMasked.
' The graphics come from the asset pipeline: examples/assets/
' make_finetiles_png.py draws the PNGs, tools/build_assets.sh converts them
' (img2cpc.py --tiles --tile-width 4 --dedupe) into the includes below.
' ESC quits.
'
'   make run PROG=examples/finetiles.bas
'
' Benchmark: built with -D BENCH it runs 250 updates, then prints the
' rate, timed with Frames() (headless: tools/cpcrun.py
' examples/finetiles.bas --zxbc-arg=-D --zxbc-arg=BENCH).
'
' Screenshot test: -D SHOT=n runs n updates, takes a program-triggered
' screenshot (tests/screens/lib/shot.bas; tests/screens/run.py) and ENDs.
' ----------------------------------------------------------------

#include <cpc.bas>
#include <cpcbuild.bas>
#include <framehook.bas>

' Number of sprites, 1-8: 4 unless built with -D SPRITES=n.
#ifdef SPRITES
CONST NSPR AS UBYTE = SPRITES
#else
CONST NSPR AS UBYTE = 4
#endif

' finetiles: 10 tiles x 16 bytes (2 bytes x 8 rows), finetiles_TILEW (the
'   width for SetTileWidth), finetiles_MAP, the 40 x 25 level
'   (finetiles_MAPW x finetiles_MAPH), and finetiles_pal, the firmware
'   colours of pens 0-15 (the same as bounce's).
' finesprites: 3 sprites x 8 bytes x 16 rows x (mask, pixels), 256 bytes
'   each.
#include "assets/finetiles.bas"
#include "assets/finesprites.bas"

#ifdef SHOT
#include "../tests/screens/lib/shot.bas"
DIM shotN AS UINTEGER
#endif

#ifdef BENCH
DIM benchT AS ULONG
DIM benchN AS UINTEGER
#endif

' Each sprite's state is a 16-byte record in st(), reached through a
' pointer with PEEK/POKE, as in bounce.bas.
CONST BX AS UBYTE = 0                 ' x (bytes)
CONST BY AS UBYTE = 1                 ' y (lines)
CONST VX AS UBYTE = 2                 ' velocities, 8-bit two's complement
CONST VY AS UBYTE = 3                 ' (255 = -1): adding them wraps right
CONST OX AS UBYTE = 4                 ' x last drawn on screen 0, 1 (+4, +5)
CONST OY AS UBYTE = 6                 ' y last drawn on screen 0, 1 (+6, +7);
                                      ' OX = 255: not drawn there yet
CONST SPR AS UBYTE = 8                ' address of its sprite frame (2 bytes)
CONST REC AS UBYTE = 16

DIM st(NSPR * REC - 1) AS UBYTE
DIM i, buf, x, y, v AS UBYTE
DIM p AS UINTEGER

Mode 0
SetPalette(@finetiles_pal(0), finetiles_PENS)
SetBorder 0
ScreenInit()

SetTileSet(@finetiles(0))
SetTileWidth(finetiles_TILEW)
TileMap(@finetiles_MAP(0), 0, 0, finetiles_MAPW, finetiles_MAPH)
EnableDoubleBuffer()

p = @st(0)
FOR i = 0 TO NSPR - 1
  POKE p + BX, 6 + i * 16
  POKE p + BY, 24 + i * 40
  IF i bAND 1 THEN POKE p + VX, 255 ELSE POKE p + VX, 1
  POKE p + VY, 1 + (i MOD 3)
  POKE p + OX, 255
  POKE p + OX + 1, 255
  POKE UINTEGER p + SPR, @finesprites(CAST(UINTEGER, i MOD 3) * finesprites_SIZE)
  p = p + REC
NEXT i

buf = 0
#ifdef BENCH
benchT = Frames()
#endif
DO
  ' erase every sprite where this screen last showed it ...
  p = @st(0) + buf
  FOR i = 0 TO NSPR - 1
    x = PEEK(p + OX)
    IF x <> 255 THEN TileRestore(@finetiles_MAP(0), finetiles_MAPW, x, PEEK(p + OY), finesprites_W, finesprites_H)
    p = p + REC
  NEXT i
  ' ... then move and draw them all; they bounce off the brick border
  p = @st(0)
  FOR i = 0 TO NSPR - 1
    v = PEEK(p + VX)
    x = PEEK(p + BX) + v
    IF x < 2 OR x > 80 - 2 - finesprites_W THEN
      v = 0 - v
      POKE p + VX, v
      x = x + v + v
    END IF
    v = PEEK(p + VY)
    y = PEEK(p + BY) + v
    IF y < 8 OR y > 200 - 8 - finesprites_H THEN
      v = 0 - v
      POKE p + VY, v
      y = y + v + v
    END IF
    POKE p + BX, x
    POKE p + BY, y
    PutSpriteMasked(x, y, finesprites_W, finesprites_H, PEEK(UINTEGER, p + SPR))
    POKE p + OX + buf, x
    POKE p + OY + buf, y
    p = p + REC
  NEXT i
  FlipBuffer()
  buf = 1 - buf
  ScanKeys()
#ifdef BENCH
  benchN = benchN + 1
LOOP UNTIL benchN = 250
benchT = Frames() - benchT
DisableDoubleBuffer()
SetTileWidth(0)
' 50 frames a second
PRINT "INFO updates="; benchN; " frames="; benchT; " per second="; CAST(ULONG, benchN) * 500 / benchT / 10; "."; (CAST(ULONG, benchN) * 500 / benchT) MOD 10
#else
#ifdef SHOT
  shotN = shotN + 1
LOOP UNTIL shotN = SHOT
Shot("finetiles")
#else
LOOP UNTIL KeyDown(KEY_ESC)
#endif

DisableDoubleBuffer()
SetTileWidth(0)
#endif
