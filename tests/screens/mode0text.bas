REM Screen test: mode 0 text with INK/PAPER (Spectrum colours 0-7).
#include <cpc.bas>
#include "lib/shot.bas"

DIM c AS UBYTE
Mode 0
BORDER 1
PRINT AT 0, 0; "MODE 0 TEXT"
FOR c = 0 TO 7
  PRINT AT 2 + c, 0; INK c; PAPER 7 - c; "INK "; c; " PAPER "; 7 - c;
NEXT c
PRINT AT 11, 0; INK 7; PAPER 0; "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
PRINT AT 12, 0; "abcdefghijklmnopqrstuvwxyz"
PRINT AT 13, 0; "0123456789 !#$%&'()*+,-./:;<=>?@"
Shot("mode0text")
