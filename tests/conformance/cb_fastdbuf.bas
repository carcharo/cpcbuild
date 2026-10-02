REM Conformance: cpcbuild fast paths on the BACK screen (double buffering, the
REM screen at &4000, which has a different high-byte pattern from &C000):
REM unrolled PutSprite / PutSpriteMasked / GetBlock (widths 1, 2, 4, 8, shared
REM FastCase from lib/cb_fastcase.bas), in mode 0, then mode 1. A separate
REM small program because double buffering needs the code and data to fit in
REM &1000-&3FFF (12 KB); the tiles are in cb_tilesdbuf.bas.

#pragma heap_size = 1200
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/sprites.bas>

DIM results$ AS STRING
DIM npass AS UINTEGER = 0
DIM sd(0 TO 399) AS UBYTE
DIM gbuf(0 TO 199) AS UBYTE
DIM bgv AS UBYTE = $A5
DIM doff AS UINTEGER = 0

#include "lib/cb_fastcase.bas"

SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    npass = npass + 1
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

DIM fx(0 TO 5) AS UBYTE
DIM fy(0 TO 5) AS UBYTE
DIM fh(0 TO 5) AS UBYTE

SUB Sprites(m AS STRING)
  DIM wi, w, pp, x, y AS UBYTE
  fy(0) = 0:   fh(0) = 16: fx(0) = 10
  fy(1) = 3:   fh(1) = 13: fx(1) = 20
  fy(2) = 7:   fh(2) = 2:  fx(2) = 0
  fy(3) = 184: fh(3) = 16: fx(3) = 80
  fy(4) = 24:  fh(4) = 9:  fx(4) = 13
  fy(5) = 120: fh(5) = 24: fx(5) = 2
  FOR wi = 0 TO 3
    w = 1
    IF wi = 1 THEN w = 2
    IF wi = 2 THEN w = 4
    IF wi = 3 THEN w = 8
    FOR pp = 0 TO 5
      x = fx(pp)
      IF x + w > 80 THEN x = 80 - w
      y = fy(pp)
      FastChk(FastCase(x, y, w, fh(pp), 0), m, 0, w, pp, 0)
      FastChk(FastCase(x, y, w, fh(pp), 1), m, 1, w, pp, 0)
      FastChk(FastCase(x, y, w, fh(pp), 2), m, 2, w, pp, 0)
    NEXT pp
  NEXT wi
END SUB

Mode 0
ScreenInit()
EnableDoubleBuffer()
Sprites("m0")
DisableDoubleBuffer()

Mode 1
ScreenInit()
EnableDoubleBuffer()
Sprites("m1")
DisableDoubleBuffer()

Mode 1
ScreenInit()
CLS
PRINT AT 0, 0;
PRINT "PASS "; npass; " checks"
PRINT results$; "DONE"
END
