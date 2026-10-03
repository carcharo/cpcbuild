REM Spectrum screen test: a fixed picture (bitmap, attributes, border) drawn
REM straight into video RAM, compared with golden/<model>/screen.png.
#include <zxtest.bas>

DIM x, y AS UINTEGER
DIM a AS UINTEGER

BORDER 1
FOR a = 16384 TO 22527
  POKE a, 0
NEXT a
REM attributes: a 16 x 8 grid of (ink, paper, bright) combinations
FOR y = 0 TO 23
  FOR x = 0 TO 31
    POKE 22528 + y * 32 + x, ((x / 2) BAND 7) + 8 * ((y / 3) BAND 7) + 64 * ((x / 16) BAND 1)
  NEXT x
NEXT y
REM bitmap: bars, a diagonal and a chequer
FOR y = 0 TO 191
  FOR x = 0 TO 31
    a = 16384 + ((y BAND 0xC0) * 32) + ((y BAND 7) * 256) + ((y BAND 0x38) * 4) + x
    IF y < 64 THEN
      POKE a, 0xAA >> (y BAND 1)
    ELSEIF y < 128 THEN
      POKE a, 1 << (x BAND 7)
    ELSE
      IF (y / 8 + x) BAND 1 THEN POKE a, 0xF0 ELSE POKE a, 0x0F
    END IF
  NEXT x
NEXT y
PRINT AT 11, 9; "ZX ZX ZX"
TSHOT("screen")
TEND()
