REM Conformance: Phase 4b UDGs (POKE USR "a"), Spectrum block graphics
REM CHR$ 128-143, and the CPC's own characters above 164.
REM
REM Character cells are read back with POINT (pens). Mode 1, row 23 covers
REM pixel rows 15 (top) down to 8, column c covers x 8c to 8c+7. The
REM quadrants of a cell are 4x4 pixels.

#include <point.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

REM Lit pixels in a w x h box with bottom-left corner (x, y).
FUNCTION Lit(x AS INTEGER, y AS INTEGER, w AS INTEGER, h AS INTEGER) AS UINTEGER
  DIM i, j AS INTEGER
  DIM n AS UINTEGER = 0
  FOR j = y TO y + h - 1
    FOR i = x TO x + w - 1
      IF POINT(i, j) THEN n = n + 1
    NEXT i
  NEXT j
  RETURN n
END FUNCTION

DIM i AS UBYTE

REM --- USR "a" addresses: consecutive 8-byte cells, in the central 32K ---
CHK("usr_a_central_32k", STR$(USR "a" >= $4000 AND USR "a" < $C000), "1")
CHK("usr_b_next", STR$(USR "b" - USR "a"), "8")
CHK("usr_u_last", STR$(USR "u" - USR "a"), "160")

REM --- define UDG "a" as a top-half block, "u" as a left-half block ---
FOR i = 0 TO 7
  IF i < 4 THEN POKE USR "a" + i, 255 ELSE POKE USR "a" + i, 0
  POKE USR "u" + i, $F0
NEXT i
PRINT AT 23, 0; CHR$ 144; CHR$ 164;
CHK("udg_a_top_lit", STR$(Lit(0, 12, 8, 4)), "32")
CHK("udg_a_bottom_unlit", STR$(Lit(0, 8, 8, 4)), "0")
CHK("udg_u_left_lit", STR$(Lit(8, 8, 4, 8)), "32")
CHK("udg_u_right_unlit", STR$(Lit(12, 8, 4, 8)), "0")

REM Redefining a UDG changes the next PRINT of it
POKE USR "a" + 7, 255
PRINT AT 23, 2; CHR$ 144;
CHK("udg_redefined", STR$(Lit(16, 8, 8, 1)), "8")

REM --- Spectrum block graphics: 128 + 1 top right, 2 top left,
REM 4 bottom right, 8 bottom left ---
PRINT AT 23, 4; CHR$ 129; CHR$ 130; CHR$ 132; CHR$ 136; CHR$ 143; CHR$ 128;
CHK("block_129_top_right", STR$(Lit(36, 12, 4, 4)) + "/" + STR$(Lit(32, 8, 8, 8)), "16/16")
CHK("block_130_top_left", STR$(Lit(40, 12, 4, 4)) + "/" + STR$(Lit(40, 8, 8, 8)), "16/16")
CHK("block_132_bottom_right", STR$(Lit(52, 8, 4, 4)) + "/" + STR$(Lit(48, 8, 8, 8)), "16/16")
CHK("block_136_bottom_left", STR$(Lit(56, 8, 4, 4)) + "/" + STR$(Lit(56, 8, 8, 8)), "16/16")
CHK("block_143_full", STR$(Lit(64, 8, 8, 8)), "64")
CHK("block_128_empty", STR$(Lit(72, 8, 8, 8)), "0")

REM --- characters past the UDGs keep the CPC's own glyphs (the firmware
REM copies them into the new table) ---
PRINT AT 23, 12; CHR$ 165; CHR$ 255;
CHK("chr165_not_blank", STR$(Lit(96, 8, 8, 8) > 0), "1")
CHK("chr255_not_blank", STR$(Lit(104, 8, 8, 8) > 0), "1")
REM and ordinary text still works
PRINT AT 23, 16; "A";
CHK("letter_a_not_blank", STR$(Lit(128, 8, 8, 8) > 0), "1")

PRINT AT 0, 0;
PRINT results$; "DONE"
END
