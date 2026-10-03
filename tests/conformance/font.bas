REM BARE: skip until Phase 6 B5 (bare graphics: PLOT/DRAW/POINT still call the firmware)
REM Conformance: SetFont (font.bas) -- a custom font for characters 32-127,
REM and how it coexists with UDGs and the CPC glyphs above 127.
REM
REM Character cells are read back with POINT (pens). Mode 1, row r covers
REM pixel rows 199-8r (top) down to 192-8r, column c covers x 8c to 8c+7.

#include <point.bas>
#include <font.bas>

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

REM Font data: 96 glyphs of 8 bytes. Every character is a solid block;
REM 'A' (index 33) is a top-half block, 'B' (34) a left-half block.
DIM f(767) AS UBYTE
DIM g(767) AS UBYTE
DIM i AS UINTEGER
DIM k AS UBYTE
FOR i = 0 TO 767
  f(i) = 255
  g(i) = 0
NEXT i
FOR k = 4 TO 7
  f(33 * 8 + k - 0) = 0
NEXT k
FOR k = 0 TO 7
  f(34 * 8 + k) = $F0
  g(33 * 8 + k) = $0F         REM second font: 'A' is a right-half block
NEXT k

REM --- before SetFont: a UDG, and the CPC's own letter A ---
FOR k = 0 TO 7
  POKE USR "a" + k, $AA
NEXT k
POKE USR "c", 255

SetFont(@f(0))

REM Row 23 = pixel rows 15..8; columns 0.. from x = 0.
PRINT AT 23, 0; "AB@";
CHK("A_top_half", STR$(Lit(0, 12, 8, 4)) + "/" + STR$(Lit(0, 8, 8, 4)), "32/0")
CHK("B_left_half", STR$(Lit(8, 8, 4, 8)) + "/" + STR$(Lit(12, 8, 4, 8)), "32/0")
CHK("at_solid", STR$(Lit(16, 8, 8, 8)), "64")

PRINT AT 22, 0; "z~ ";
REM char 32 (space) is a solid block now too
CHK("z_solid", STR$(Lit(0, 16, 8, 8)), "64")
CHK("tilde_solid", STR$(Lit(8, 16, 8, 8)), "64")
CHK("space_solid", STR$(Lit(16, 16, 8, 8)), "64")

REM --- a character above 127 keeps a CPC glyph ---
PRINT AT 21, 0; CHR$ 200; CHR$ 255;
CHK("chr200_not_blank", STR$(Lit(0, 24, 8, 8) > 0), "1")
CHK("chr200_not_solid", STR$(Lit(0, 24, 8, 8) < 64), "1")
CHK("chr255_not_blank", STR$(Lit(8, 24, 8, 8) > 0), "1")

REM --- UDG defined before SetFont survives ---
PRINT AT 20, 0; CHR$ 144; CHR$ 146;
CHK("udg_a_before_survives", STR$(Lit(0, 32, 8, 8)), "32")
REM (c was only POKEd at row 0 -> top row lit)
CHK("udg_c_top_row", STR$(Lit(8, 39, 8, 1)), "8")

REM --- UDG defined after SetFont works through the new USR "a" ---
FOR k = 0 TO 7
  POKE USR "d" + k, $0F
NEXT k
PRINT AT 19, 0; CHR$ 147;
CHK("udg_d_after_right", STR$(Lit(4, 40, 4, 8)) + "/" + STR$(Lit(0, 40, 4, 8)), "32/0")
#ifdef CPC_BAREMETAL
CHK("usr_a_in_central_32k", STR$(USR "a" >= $0040 AND USR "a" < $B800), "1")
#else
CHK("usr_a_in_central_32k", STR$(USR "a" >= $4000 AND USR "a" < $C000), "1")
#endif
CHK("usr_b_next", STR$(USR "b" - USR "a"), "8")

REM --- a second SetFont replaces the glyphs (no new allocation) ---
SetFont(@g(0))
PRINT AT 18, 0; "AB";
CHK("second_A_right_half", STR$(Lit(4, 48, 4, 8)) + "/" + STR$(Lit(0, 48, 4, 8)), "32/0")
CHK("second_B_blank", STR$(Lit(8, 48, 8, 8)), "0")
REM UDGs still fine after the second call
PRINT AT 17, 0; CHR$ 147;
CHK("udg_d_after_second", STR$(Lit(4, 56, 4, 8)), "32")

PRINT AT 0, 0;
PRINT results$; "DONE"
END
