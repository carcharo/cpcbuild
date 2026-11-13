REM Screen test: PLOT / DRAW / CIRCLE in mode 1, three colours, plus one
REM pixel-pair pattern line drawn in XOR mode to show XOR drawing.
REM PLOT and DRAW count in 640 x 400 units, so a mode 1 pixel (x, y) is (2x, 2y); CIRCLE keeps
REM the mode's pixels. The pens are the ones 0.1.x gave the Spectrum colours 7, 4, 2 and 6 in
REM mode 1: 1, 2, 3 and 1.
#include <cpc.bas>
#include "lib/shot.bas"

DIM i AS UBYTE
DIM x AS INTEGER
Mode 1
BORDER 1
GRAPHICS PEN 1
FOR i = 0 TO 15
  PLOT 2 * (20 + i * 6), 20
NEXT i
PLOT 20, 200
DRAWR 600, 40
GRAPHICS PEN 2
PLOT 20, 40
DRAWR 600, 200
DRAWR 0, 80
GRAPHICS PEN 3
CIRCLE 160, 100, 60
CIRCLE 160, 100, 30
GRAPHICS PEN 1
CIRCLE 60, 140, 20
PLOT 0, 0
DRAWR 638, 0
DRAWR 0, 398
DRAWR -638, 0
DRAWR 0, -398
REM the line at y = 150 from x = 100 to 300, XOR mode: the ink mode of PLOT and DRAW is
REM firmware only, so a bare build XORs the pen of each pixel by hand
#ifdef CPC_BAREMETAL
FOR x = 100 TO 300
  PLOT 2 * x, 300, POINT(x, 150) XOR 1
NEXT x
#else
MOVE 200, 300
DRAWR 400, 0, 1, 1
#endif
Shot("graphics")
