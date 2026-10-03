REM Spectrum 128K conformance: AY-3-8912 registers through &FFFD (select,
REM read) and &BFFD (write).
REM MODELS: 128
#include <zxtest.bas>

FUNCTION AyGet(r AS UBYTE) AS UBYTE
  OUT 65533, r
  RETURN IN(65533)
END FUNCTION

SUB AySet(r AS UBYTE, v AS UBYTE)
  OUT 65533, r
  OUT 49149, v
END SUB

DIM r AS UBYTE
AySet(0, 0x5A)
AySet(1, 0x03)
AySet(2, 0xC3)
AySet(7, 0x3E)
AySet(8, 0x0F)
CHK("ay_r0", STR$(AyGet(0)), "90")
CHK("ay_r1", STR$(AyGet(1)), "3")
CHK("ay_r2", STR$(AyGet(2)), "195")
CHK("ay_r7", STR$(AyGet(7)), "62")
CHK("ay_r8", STR$(AyGet(8)), "15")
AySet(1, 0xFF)
CHK("ay_r1_masked", STR$(AyGet(1)), "15")
AySet(8, 0xFF)
CHK("ay_r8_masked", STR$(AyGet(8)), "31")
AySet(0, 1)
CHK("ay_rewrite", STR$(AyGet(0)) + "," + STR$(AyGet(2)), "1,195")
AySet(7, 0xFF)
AySet(8, 0)
TEND()
