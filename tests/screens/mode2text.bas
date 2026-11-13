REM Screen test: mode 2 text in eight pen pairs: the pens that CPCBuild 0.1.x gave
REM the Spectrum colours 0-7 in this mode (mapped by hand: INK c; PAPER 7 - c).
#include <cpc.bas>
#include "lib/shot.bas"

DIM c AS UBYTE
DIM pens(7) AS UBYTE => {0, 0, 0, 0, 1, 1, 1, 1}
Mode 2
BORDER 1
PEN pens(7): PAPER pens(0)
PRINT AT 0, 0; "MODE 2 TEXT"
FOR c = 0 TO 7
  PEN pens(c): PAPER pens(7 - c)
  PRINT AT 2 + c, 0; "INK "; CHR$(48 + c); " PAPER "; CHR$(55 - c); " ";
NEXT c
PEN pens(7): PAPER pens(0)
PRINT AT 11, 0; "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
PRINT AT 12, 0; "abcdefghijklmnopqrstuvwxyz"
PRINT AT 13, 0; "0123456789 !#$%&'()*+,-./:;<=>?@"
Shot("mode2text")
