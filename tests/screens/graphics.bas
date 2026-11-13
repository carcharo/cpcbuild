REM Screen test: PLOT / DRAW / CIRCLE in mode 1, three colours, plus one
REM mode 2 pixel-pair pattern line (OVER 1) to show XOR drawing.
#include <cpc.bas>
#include "lib/shot.bas"

DIM i AS UBYTE
Mode 1
BORDER 0
PEN 7
FOR i = 0 TO 15
  PLOT 20 + i * 6, 10
NEXT i
PLOT 10, 100
DRAWR 300, 20
PEN 4
PLOT 10, 20
DRAWR 300, 100
DRAWR 0, 100 - 60
PEN 2
CIRCLE 160, 100, 60
CIRCLE 160, 100, 30
PEN 6
CIRCLE 60, 140, 20
PEN 7
PLOT 0, 0
DRAWR 319, 0
DRAWR 0, 199
DRAWR -319, 0
DRAWR 0, -199
OVER 1
PLOT 100, 150
DRAWR 200, 0
OVER 0
Shot("graphics")
