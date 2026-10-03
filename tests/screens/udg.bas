REM Screen test: UDGs (POKE USR "a"), Spectrum block graphics (CHR$ 128-143),
REM and the CPC's own characters from 144 up, in mode 1.
#include <cpc.bas>
#include "lib/shot.bas"

DIM i AS UBYTE
DIM c AS UINTEGER
Mode 1
REM "a": a diagonal stripe, "b": a box, "c": a smiley-ish face
FOR i = 0 TO 7
  POKE USR "a" + i, 1 << i
  IF i = 0 OR i = 7 THEN POKE USR "b" + i, 255 ELSE POKE USR "b" + i, 129
NEXT i
POKE USR "c" + 0, 60
POKE USR "c" + 1, 66
POKE USR "c" + 2, 165
POKE USR "c" + 3, 129
POKE USR "c" + 4, 165
POKE USR "c" + 5, 153
POKE USR "c" + 6, 66
POKE USR "c" + 7, 60
PRINT AT 0, 0; "UDGs:";
PRINT AT 1, 0; CHR$ 144; CHR$ 145; CHR$ 146; CHR$ 144; CHR$ 145; CHR$ 146
PRINT AT 3, 0; "Blocks 128-143:"
PRINT AT 4, 0;
FOR c = 128 TO 143
  PRINT CHR$ c;
NEXT c
PRINT AT 6, 0; "Chars 144-255:"
FOR c = 144 TO 255
  PRINT AT 7 + (c - 144) / 40, (c - 144) MOD 40; CHR$ c;
NEXT c
Shot("udg")
