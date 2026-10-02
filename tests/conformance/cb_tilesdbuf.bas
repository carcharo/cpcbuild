REM Conformance: cpcbuild tiles on the BACK screen (double buffering, the screen
REM at &4000, which has a different high-byte pattern from &C000): the unrolled
REM TileMap and DoTile8 drawers in mode 0 and mode 1. A separate small program
REM because double buffering needs the code and data to fit in &1000-&3FFF.

#pragma heap_size = 1200
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/tiles.bas>

DIM results$ AS STRING
DIM npass AS UINTEGER = 0

SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    npass = npass + 1
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

REM Tile t's byte at row r, byte column b: ((t*29 + r*7 + b*3) AND 127) + 1.
DIM ts(0 TO 24 * 32 - 1) AS UBYTE
DIM mpf(0 TO 799) AS UBYTE

SUB FillTS(w AS UBYTE)
  DIM t, r, b AS UBYTE
  DIM i AS UINTEGER = 0
  FOR t = 0 TO 23
    FOR r = 0 TO 7
      FOR b = 0 TO w - 1
        ts(i) = ((t * 29 + r * 7 + b * 3) AND 127) + 1
        i = i + 1
      NEXT b
    NEXT r
  NEXT t
END SUB

REM Bytes of the tile cell (cx, cy) that aren't tile t's (via PeekScreen).
FUNCTION TileBad(cx AS UBYTE, cy AS UBYTE, t AS UBYTE, w AS UBYTE) AS UBYTE
  DIM r, b, bad AS UBYTE
  DIM i AS UINTEGER
  bad = 0
  i = CAST(UINTEGER, t) * 8 * w
  FOR r = 0 TO 7
    FOR b = 0 TO w - 1
      IF PeekScreen(cx * w + b, cy * 8 + r) <> ts(i) THEN bad = bad + 1
      i = i + 1
    NEXT b
  NEXT r
  RETURN bad
END FUNCTION

SUB Tiles(m AS STRING, w AS UBYTE)
  DIM cx, cy, cxs AS UBYTE
  DIM bad AS UINTEGER
  cxs = 80 / w
  FillTS(w)
  SetTileSet(@ts(0))
  FOR cy = 0 TO 19
    FOR cx = 0 TO cxs - 1
      mpf(CAST(UINTEGER, cy) * cxs + cx) = (cx + cy * 3) MOD 24
    NEXT cx
  NEXT cy
  TileMap(@mpf(0), 0, 0, cxs, 20)
  bad = 0
  FOR cy = 0 TO 19
    IF cy < 2 OR cy = 3 OR cy = 7 OR cy = 12 OR cy = 19 THEN
      FOR cx = 0 TO cxs - 1
        bad = bad + TileBad(cx, cy, (cx + cy * 3) MOD 24, w)
      NEXT cx
    END IF
  NEXT cy
  CHK(m + "_map_back", STR$(bad), "0")
  REM DoTile8 over the same cells with other tiles
  bad = 0
  FOR cy = 0 TO 19
    IF cy < 2 OR cy = 3 OR cy = 7 OR cy = 12 OR cy = 19 THEN
      FOR cx = 0 TO cxs - 1
        DoTile8(cx, cy, (cx * 5 + cy) MOD 24)
        bad = bad + TileBad(cx, cy, (cx * 5 + cy) MOD 24, w)
      NEXT cx
    END IF
  NEXT cy
  CHK(m + "_tile8_back", STR$(bad), "0")
END SUB

Mode 0
ScreenInit()
EnableDoubleBuffer()
Tiles("m0", 4)
DisableDoubleBuffer()

Mode 1
ScreenInit()
EnableDoubleBuffer()
Tiles("m1", 2)
DisableDoubleBuffer()

Mode 1
ScreenInit()
CLS
PRINT AT 0, 0;
PRINT "PASS "; npass; " checks"
PRINT results$; "DONE"
END
