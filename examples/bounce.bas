' ----------------------------------------------------------------
' bounce.bas -- cpcbuild demo (Amstrad CPC, mode 0)
'
' A tiled background with eight shaded balls bouncing around it,
' double-buffered. The graphics come from the asset pipeline: the PNG and
' TMX sources in assets/ are converted by tools/build_assets.sh
' (img2cpc.py, tmx2bas.py) into the .bas includes below. ESC quits.
' Runs at 25 updates a second (every other frame): each ball is erased
' with one TileRestore call and drawn with one PutSpriteMasked.
'
'   zxbasic/tools/cpc/run.sh cpcbuild/examples/bounce.bas
'
' Benchmark: built with -D BENCH it runs 250 updates, then prints the
' rate (headless: tools/cpcrun.py examples/bounce.bas --zxbc-arg=-D
' --zxbc-arg=BENCH).
' ----------------------------------------------------------------

#include <cpc.bas>
#include <cpcbuild.bas>

CONST NBALLS AS UBYTE = 8

' bgtiles: 3 tiles x 32 bytes (4 bytes x 8 rows), and bgtiles_pal, the
'   firmware colours of pens 0-15: black, blue, bright blue, sky blue,
'   bright cyan, bright white, red, bright red, orange, bright yellow,
'   green, bright green, magenta, bright magenta, white, cyan.
' level: the 20 x 25 tile map (level_W x level_H), from level.tmx.
' balls: 3 balls x 4 bytes x 16 rows x (mask, pixels), 128 bytes each.
#include "assets/bgtiles.bas"
#include "assets/level.bas"
#include "assets/balls.bas"

#ifdef BENCH
' KL TIME PLEASE (&BD0D): the firmware's 300 Hz clock.
FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION
DIM benchT AS ULONG
DIM benchN AS UINTEGER
#endif

' --- main ------------------------------------------------------------

' Each ball's state is a 16-byte record in st(), reached through a
' pointer with PEEK/POKE: an array element with a variable index costs a
' call to the compiler's general array routine (a few hundred T-states),
' a PEEK through a pointer only a few instructions, and this loop runs
' for 8 balls 12-25 times a second.
CONST BX AS UBYTE = 0                 ' x (bytes)
CONST BY AS UBYTE = 1                 ' y (lines)
CONST VX AS UBYTE = 2                 ' velocities, 8-bit two's complement
CONST VY AS UBYTE = 3                 ' (255 = -1): adding them wraps right
CONST OX AS UBYTE = 4                 ' x last drawn on screen 0, 1 (+4, +5)
CONST OY AS UBYTE = 6                 ' y last drawn on screen 0, 1 (+6, +7);
                                      ' OX = 255: not drawn there yet
CONST SPR AS UBYTE = 8                ' address of its sprite frame (2 bytes)
CONST REC AS UBYTE = 16

DIM st(NBALLS * REC - 1) AS UBYTE
DIM i, buf, x, y, v AS UBYTE
DIM p AS UINTEGER

Mode 0
SetPalette(@bgtiles_pal(0), bgtiles_PENS)
SetBorder 0
ScreenInit()

SetTileSet(@bgtiles(0))
TileMap(@level(0), 0, 0, level_W, level_H)
EnableDoubleBuffer()

p = @st(0)
FOR i = 0 TO NBALLS - 1
  POKE p + BX, 6 + i * 8
  POKE p + BY, 12 + i * 20
  IF i bAND 1 THEN POKE p + VX, 255 ELSE POKE p + VX, 1
  POKE p + VY, 2 + (i MOD 3)
  POKE p + OX, 255
  POKE p + OX + 1, 255
  POKE UINTEGER p + SPR, @balls(CAST(UINTEGER, i MOD 3) * balls_SIZE)
  p = p + REC
NEXT i

buf = 0
#ifdef BENCH
benchT = Ticks()
#endif
DO
  ' erase every ball where this screen last showed it ...
  p = @st(0) + buf
  FOR i = 0 TO NBALLS - 1
    x = PEEK(p + OX)
    IF x <> 255 THEN TileRestore(@level(0), level_W, x, PEEK(p + OY), balls_W, balls_H)
    p = p + REC
  NEXT i
  ' ... then move and draw them all
  p = @st(0)
  FOR i = 0 TO NBALLS - 1
    v = PEEK(p + VX)
    x = PEEK(p + BX) + v
    IF x < 4 OR x > 80 - 4 - 4 THEN
      v = 0 - v
      POKE p + VX, v
      x = x + v + v
    END IF
    v = PEEK(p + VY)
    y = PEEK(p + BY) + v
    IF y < 8 OR y > 200 - 8 - 16 THEN
      v = 0 - v
      POKE p + VY, v
      y = y + v + v
    END IF
    POKE p + BX, x
    POKE p + BY, y
    PutSpriteMasked(x, y, balls_W, balls_H, PEEK(UINTEGER, p + SPR))
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
benchT = Ticks() - benchT
DisableDoubleBuffer()
PRINT "INFO updates="; benchN; " ticks="; benchT; " per second="; CAST(ULONG, benchN) * 3000 / benchT / 10; "."; (CAST(ULONG, benchN) * 3000 / benchT) MOD 10
#else
LOOP UNTIL KeyDown(KEY_ESC)

DisableDoubleBuffer()
#endif
