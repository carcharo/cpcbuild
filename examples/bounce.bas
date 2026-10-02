' ----------------------------------------------------------------
' bounce.bas -- cpcbuild demo (Amstrad CPC, mode 0)
'
' A tiled background with eight shaded balls bouncing around it,
' double-buffered. The graphics come from the asset pipeline: the PNG and
' TMX sources in assets/ are converted by tools/build_assets.sh
' (img2cpc.py, tmx2bas.py) into the .bas includes below. ESC quits.
'
'   zxbasic/tools/cpc/run.sh cpcbuild/examples/bounce.bas
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

' Redraws the background tiles under a ball (4 bytes x 16 lines): the
' 2 or 3 rows of 1 or 2 tile cells it covers. Shifts, not division, and
' 8-bit positions: this runs for every ball every frame.
SUB EraseBall(x AS UBYTE, y AS UBYTE)
  DIM cx, cy, cx0, cx1, cy1 AS UBYTE
  DIM p AS UINTEGER
  cx0 = x >> 2
  cx1 = (x + 3) >> 2
  cy1 = (y + 15) >> 3
  FOR cy = y >> 3 TO cy1
    p = (CAST(UINTEGER, cy) << 4) + (CAST(UINTEGER, cy) << 2)   ' cy * 20
    FOR cx = cx0 TO cx1
      DoTile8(cx, cy, level(p + cx))
    NEXT cx
  NEXT cy
END SUB

' --- main ------------------------------------------------------------

DIM bx(7) AS UBYTE
DIM by(7) AS UBYTE
DIM vx(7) AS UBYTE                    ' velocities, 8-bit two's complement
DIM vy(7) AS UBYTE                    ' (255 = -1): adding them wraps right
DIM ox(1, 7) AS UBYTE                 ' last position drawn on each screen,
DIM oy(1, 7) AS UBYTE                 ' 255 = none yet
DIM i, buf AS UBYTE

Mode 0
SetPalette(@bgtiles_pal(0), bgtiles_PENS)
SetBorder 0
ScreenInit()

SetTileSet(@bgtiles(0))
TileMap(@level(0), 0, 0, level_W, level_H)
EnableDoubleBuffer()

FOR i = 0 TO NBALLS - 1
  bx(i) = 6 + i * 8
  by(i) = 12 + i * 20
  IF i bAND 1 THEN vx(i) = 255 ELSE vx(i) = 1
  vy(i) = 2 + (i MOD 3)
  ox(0, i) = 255
  ox(1, i) = 255
NEXT i

buf = 0
DO
  ' erase every ball where this screen last showed it ...
  FOR i = 0 TO NBALLS - 1
    IF ox(buf, i) <> 255 THEN EraseBall(ox(buf, i), oy(buf, i))
  NEXT i
  ' ... then move and draw them all
  FOR i = 0 TO NBALLS - 1
    bx(i) = bx(i) + vx(i)
    by(i) = by(i) + vy(i)
    IF bx(i) < 4 OR bx(i) > 80 - 4 - 4 THEN
      vx(i) = 0 - vx(i)
      bx(i) = bx(i) + 2 * vx(i)
    END IF
    IF by(i) < 8 OR by(i) > 200 - 8 - 16 THEN
      vy(i) = 0 - vy(i)
      by(i) = by(i) + 2 * vy(i)
    END IF
    PutSpriteMasked(bx(i), by(i), balls_W, balls_H, @balls(CAST(UINTEGER, i MOD 3) * balls_SIZE))
    ox(buf, i) = bx(i)
    oy(buf, i) = by(i)
  NEXT i
  FlipBuffer()
  buf = 1 - buf
  ScanKeys()
LOOP UNTIL KeyDown(KEY_ESC)

DisableDoubleBuffer()
