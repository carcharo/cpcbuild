REM Screen test: all 16 pens of mode 0 as 10x... columns, set with SetPalette
REM (pen p = firmware colour 7*p mod 27: 16 distinct colours), border set
REM with SetBorder.
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/fill.bas>
#include <cpcbuild/palette.bas>
#include "lib/shot.bas"

DIM pal(15) AS UBYTE
DIM p AS UBYTE
FOR p = 0 TO 15
  pal(p) = (p * 7) MOD 27
NEXT p

Mode 0
ScreenInit()
SetPalette(@pal(0), 16)
SetBorder 26
FOR p = 0 TO 15
  FillRect(p * 5, 0, 5, 100, p)
  FillRect(p * 5, 100, 5, 100, 15 - p)
NEXT p
Shot("palette")
