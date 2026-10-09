REM Screen test: cpcbuild/spritelist.bas in mode 0 -- sprites of 1x4, 2x8,
REM 4x8, 3x6 (general loop) and 8x16 bytes moving over a black background,
REM single buffered then double buffered, with Shot() calls after frames that
REM must show no trail of the earlier frames. SPRLIST_MAX is 8: the last
REM single-buffered frame calls SprListDraw ten times and the 9th and 10th
REM are not drawn.
#define SPRLIST_MAX 8
#include <cpc.bas>
#include <cpcbuild.bas>
#include "lib/shot.bas"

DIM s14(3) AS UBYTE
DIM s28(15) AS UBYTE
DIM s48(31) AS UBYTE
DIM s36(17) AS UBYTE
DIM s816(127) AS UBYTE
DIM pal(15) AS UBYTE
DIM inks(15) AS UBYTE => {0, 26, 6, 18, 2, 24, 15, 9, 20, 12, 3, 25, 8, 14, 22, 1}
DIM f AS UBYTE
DIM i AS UBYTE

REM A w x h sprite of screen bytes: a frame of the pen, a checker inside it
REM in the pen + 1 (pen 0 is transparent).
SUB MakeSprite(addr AS UINTEGER, w AS UBYTE, h AS UBYTE, pen AS UBYTE)
  DIM r, c, b AS UBYTE
  FOR r = 0 TO h - 1
    FOR c = 0 TO w - 1
      b = 0
      IF ((r + c) BAND 1) = 0 THEN b = PenByte(pen + 1)
      IF r = 0 OR r = h - 1 OR c = 0 OR c = w - 1 THEN b = PenByte(pen)
      POKE addr + CAST(UINTEGER, r) * w + c, b
    NEXT c
  NEXT r
END SUB

REM One frame's sprites for step f: n of them (1-6), 6 = all.
SUB DrawAll(f AS UBYTE, n AS UBYTE)
  SprListDraw(4 + 3 * f, 10 + 12 * f, 1, 4, @s14(0))
  IF n > 1 THEN SprListDraw(12 + 4 * f, 30 + 8 * f, 2, 8, @s28(0))
  IF n > 2 THEN SprListDraw(30 + 5 * f, 70 - 4 * f, 4, 8, @s48(0))
  IF n > 3 THEN SprListDraw(60 - 6 * f, 100 + 10 * f, 3, 6, @s36(0))
  IF n > 4 THEN SprListDraw(32 + 5 * f, 73 - 4 * f, 4, 8, @s48(0))
  IF n > 5 THEN SprListDraw(2 + 8 * f, 150, 8, 16, @s816(0))
END SUB

Mode 0
FOR i = 0 TO 15
  pal(i) = PEEK(@inks(0) + i)
NEXT i
SetPalette(@pal(0), 16)
SetBorder 0
ScreenInit()
ClearScreen(0)
MakeSprite(@s14(0), 1, 4, 1)
MakeSprite(@s28(0), 2, 8, 3)
MakeSprite(@s48(0), 4, 8, 5)
MakeSprite(@s36(0), 3, 6, 7)
MakeSprite(@s816(0), 8, 16, 9)

REM ---- single buffered
SprListReset()
FOR f = 0 TO 2
  SprListBegin()
  DrawAll(f, 6)
  SprListEnd()
NEXT f
Shot("spritelist_single1")
REM two more steps; the fourth frame draws only three sprites
f = 3
SprListBegin(): DrawAll(f, 6): SprListEnd()
f = 4
SprListBegin(): DrawAll(f, 3): SprListEnd()
Shot("spritelist_single2")
REM capacity: ten calls, eight drawn
SprListBegin()
FOR i = 0 TO 9
  SprListDraw(4 + 7 * i, 180, 1, 4, @s14(0))
NEXT i
SprListEnd()
Shot("spritelist_cap")

REM ---- double buffered
ClearScreen(0)
SprListReset()
EnableDoubleBuffer()
FOR f = 0 TO 4
  SprListBegin()
  DrawAll(f, 6)
  SprListEnd()
  FlipBuffer()
NEXT f
Shot("spritelist_dbl1")
FOR f = 5 TO 6
  SprListBegin()
  DrawAll(f - 5, 3)
  SprListEnd()
  FlipBuffer()
NEXT f
Shot("spritelist_dbl2")
REM a frame with nothing: both screens must end up empty of sprites
FOR f = 0 TO 2
  SprListBegin()
  SprListEnd()
  FlipBuffer()
NEXT f
Shot("spritelist_dbl3")

REM ---- single buffered again, on a pen 2 background with SprListPaper
DisableDoubleBuffer()
ClearScreen(2)
SprListPaper(PenByte(2))
SprListReset()
FOR f = 0 TO 2
  SprListBegin()
  DrawAll(f, 6)
  SprListEnd()
NEXT f
SprListBegin()
DrawAll(3, 3)
SprListEnd()
Shot("spritelist_paper")
