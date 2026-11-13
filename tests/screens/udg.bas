REM Screen test: user-defined characters (SYMBOL), the block graphics (CHR$ 128-143),
REM and the CPC's own characters from 144 up, in mode 1.
#include <cpc.bas>
#include "lib/shot.bas"

DIM c AS UINTEGER
DIM t, b AS UBYTE
REM the user-defined characters start at 128 here: 0.1.x had the Spectrum's block graphics at
REM 128-143 and the UDGs "a" to "c" at 144-146, so they are defined to match
SYMBOL AFTER 128
Mode 1
REM the Spectrum's block graphics: bits 0 and 1 of the code are the right and left quarters of
REM the top half, bits 2 and 3 of the bottom half
FOR c = 0 TO 15
  t = 0: b = 0
  IF c AND 1 THEN t = t + &0F
  IF c AND 2 THEN t = t + &F0
  IF c AND 4 THEN b = b + &0F
  IF c AND 8 THEN b = b + &F0
  SYMBOL 128 + c, t, t, t, t, b, b, b, b
NEXT c
REM 144: a diagonal stripe, 145: a box, 146: a smiley-ish face
SYMBOL 144, 1, 2, 4, 8, 16, 32, 64, 128
SYMBOL 145, 255, 129, 129, 129, 129, 129, 129, 255
SYMBOL 146, 60, 66, 165, 129, 165, 153, 66, 60
PRINT AT 0, 0; "UDGs:";
PRINT AT 1, 0; CHR$(144); CHR$(145); CHR$(146); CHR$(144); CHR$(145); CHR$(146)
PRINT AT 3, 0; "Blocks 128-143:"
PRINT AT 4, 0;
FOR c = 128 TO 143
  PRINT CHR$(c);
NEXT c
PRINT AT 6, 0; "Chars 144-255:"
FOR c = 144 TO 255
  PRINT AT 7 + (c - 144) / 40, (c - 144) MOD 40; CHR$(c);
NEXT c
Shot("udg")
