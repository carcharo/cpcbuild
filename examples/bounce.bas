' ----------------------------------------------------------------
' bounce.bas -- cpcbuild demo (Amstrad CPC, mode 0)
'
' A tiled background with eight shaded balls bouncing around it,
' double-buffered. Tiles and sprites are built by the program itself
' (no asset pipeline yet). ESC quits.
'
'   zxbasic/tools/cpc/run.sh cpcbuild/examples/bounce.bas
' ----------------------------------------------------------------

#include <cpc.bas>
#include <cpcbuild.bas>

CONST NBALLS AS UBYTE = 8
CONST MAPW AS UBYTE = 20          ' mode 0: 20 tiles of 8x8 pixels across
CONST MAPH AS UBYTE = 25

' Firmware colours for pens 0-15: black, blue, bright blue, sky blue,
' bright cyan, bright white, red, bright red, orange, bright yellow,
' green, bright green, magenta, bright magenta, white, cyan.
DIM pal(15) AS UBYTE => {0, 1, 2, 11, 20, 26, 3, 6, 15, 24, 9, 18, 4, 8, 13, 10}

DIM tiles(95) AS UBYTE            ' 3 tiles x 32 bytes (4 bytes x 8 rows)
DIM map(499) AS UBYTE             ' 20 x 25 tiles
DIM spr(383) AS UBYTE             ' 3 balls x 4 bytes x 16 rows x (mask, pixels)

' --- building the graphics -------------------------------------------

' Mode 0 has 2 pixels per byte: the left one in the bits of &AA, the
' right one in &55; PenByte gives a byte with both pixels in a pen.
SUB TilePixel(t AS UBYTE, px AS UBYTE, py AS UBYTE, pen AS UBYTE)
  DIM i AS UINTEGER
  DIM m AS UBYTE
  i = t * 32 + py * 4 + px / 2
  IF px bAND 1 THEN m = $55 ELSE m = $AA
  tiles(i) = (tiles(i) bAND (m bXOR $FF)) bOR (PenByte(pen) bAND m)
END SUB

SUB MakeTiles()
  DIM x, y AS UBYTE
  FOR y = 0 TO 7
    FOR x = 0 TO 7
      ' tile 0: dark blue with a faint dot
      IF x = 3 AND y = 3 THEN TilePixel(0, x, y, 2) ELSE TilePixel(0, x, y, 1)
      ' tile 1: brick, black mortar
      IF y = 3 OR y = 7 OR (y < 3 AND x = 7) OR (y > 3 AND x = 3) THEN
        TilePixel(1, x, y, 0)
      ELSEIF y = 0 OR y = 4 THEN
        TilePixel(1, x, y, 8)
      ELSE
        TilePixel(1, x, y, 7)
      END IF
      ' tile 2: lighter blue with a sky-blue corner
      IF x < 2 AND y < 2 THEN TilePixel(2, x, y, 3) ELSE TilePixel(2, x, y, 2)
    NEXT x
  NEXT y
END SUB

SUB MakeMap()
  DIM x, y AS UINTEGER                ' 16-bit: y * MAPW goes past 255
  FOR y = 0 TO MAPH - 1
    FOR x = 0 TO MAPW - 1
      IF x = 0 OR y = 0 OR x = MAPW - 1 OR y = MAPH - 1 THEN
        map(y * MAPW + x) = 1
      ELSEIF (x + y) bAND 1 THEN
        map(y * MAPW + x) = 2
      ELSE
        map(y * MAPW + x) = 0
      END IF
    NEXT x
  NEXT y
END SUB

' Ball b (0-2), 8x16 pixels -- round on screen, since a mode 0 pixel is
' twice as wide as it is tall -- shaded with pens dark/mid/light plus a
' white highlight; outside the circle is transparent (mask bits set).
' Distances are in half-line units: a pixel is 4 wide and 2 tall.
SUB MakeBall(b AS UINTEGER, dark AS UBYTE, mid AS UBYTE, lite AS UBYTE)
  DIM px, py AS INTEGER               ' signed 16-bit: 2 * px - 15 < 0
  DIM d, h AS INTEGER
  DIM pen AS UBYTE
  DIM i AS UINTEGER
  DIM m AS UBYTE
  FOR py = 0 TO 15
    FOR px = 0 TO 7
      d = (4 * px - 14) * (4 * px - 14) + (2 * py - 15) * (2 * py - 15)
      h = (4 * px - 8) * (4 * px - 8) + (2 * py - 9) * (2 * py - 9)
      i = b * 128 + (py * 4 + px / 2) * 2
      IF px bAND 1 THEN m = $55 ELSE m = $AA
      IF d > 225 THEN
        spr(i) = spr(i) bOR m              ' transparent: keep background
      ELSE
        IF h < 20 THEN
          pen = 5
        ELSEIF h < 90 THEN
          pen = lite
        ELSEIF d < 150 THEN
          pen = mid
        ELSE
          pen = dark
        END IF
        spr(i + 1) = spr(i + 1) bOR (PenByte(pen) bAND m)
      END IF
    NEXT px
  NEXT py
END SUB

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
      DoTile8(cx, cy, map(p + cx))
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
SetPalette(@pal(0), 16)
SetBorder 0
ScreenInit()

MakeTiles()
MakeMap()
MakeBall(0, 6, 7, 8)      ' red
MakeBall(1, 10, 11, 9)    ' green
MakeBall(2, 12, 13, 4)    ' magenta

SetTileSet(@tiles(0))
TileMap(@map(0), 0, 0, MAPW, MAPH)
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
    PutSpriteMasked(bx(i), by(i), 4, 16, @spr(CAST(UINTEGER, i MOD 3) * 128))
    ox(buf, i) = bx(i)
    oy(buf, i) = by(i)
  NEXT i
  FlipBuffer()
  buf = 1 - buf
  ScanKeys()
LOOP UNTIL KeyDown(KEY_ESC)

DisableDoubleBuffer()
