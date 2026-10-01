REM Conformance: SCREEN$(row, col) (firmware TXT_RD_CHAR).
REM
REM Cells are printed and read back. Behaviour of the firmware that the
REM asserts below document: TXT_RD_CHAR matches against the current text
REM pen/paper, so see the paper/pen cases.

#include <cpc.bas>
#include <screen.bas>
#include <pos.bas>
#include <csrlin.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

REM Code of the char, or -1 for ""
FUNCTION Cd(s AS STRING) AS STRING
  IF LEN(s) = 0 THEN RETURN "none"
  RETURN STR$(CODE(s))
END FUNCTION

DIM i AS UBYTE

CLS
Mode 1
PRINT AT 2, 0; "A7!";
PRINT AT 2, 5; " ";
CHK("letter", Cd(SCREEN$(2, 0)), "65")
CHK("digit", Cd(SCREEN$(2, 1)), "55")
CHK("punct", Cd(SCREEN$(2, 2)), "33")
CHK("space", Cd(SCREEN$(2, 5)), "32")
CHK("len1", STR$(LEN(SCREEN$(2, 0))), "1")

REM different pen
PRINT AT 3, 0; INK 2; "B"; INK 1;
CHK("ink2", Cd(SCREEN$(3, 0)), "66")

REM different paper. PAPER 1 (blue) maps to pen 0 in mode 1, the same pen
REM as the default paper, so it's not really different; PAPER 2 (red) is
REM pen 3 and PAPER 6 (yellow) is pen 1, the same pen as the ink.
PRINT AT 4, 0; PAPER 1; "C"; PAPER 0;
CHK("paper1_same_pen", Cd(SCREEN$(4, 0)), "67")
PRINT AT 4, 2; PAPER 2; "C"; PAPER 0;
PRINT AT 4, 4; PAPER 2; INK 4; "C"; PAPER 0; INK 7;
CHK("paper2_default_ink", Cd(SCREEN$(4, 2)), "67")
REM Known limitation (measured): with both pen and paper changed (pen 2 on
REM pen 3) the firmware misreads the cell -- as a space (32) on the 6128,
REM as a solid block (143) on the 464 -- documented in screen.bas.
CHK("paper2_ink4_misread", STR$(Cd(SCREEN$(4, 4)) <> "67"), "1")

REM Spectrum block graphics round trip
PRINT AT 5, 0; CHR$ 129; CHR$ 130; CHR$ 132; CHR$ 136; CHR$ 143; CHR$ 128;
CHK("block129", Cd(SCREEN$(5, 0)), "129")
CHK("block130", Cd(SCREEN$(5, 1)), "130")
CHK("block132", Cd(SCREEN$(5, 2)), "132")
CHK("block136", Cd(SCREEN$(5, 3)), "136")
CHK("block143", Cd(SCREEN$(5, 4)), "143")
REM CHR$ 128 is an empty cell: reads back as a space
CHK("block128_is_space", Cd(SCREEN$(5, 5)), "32")

REM UDG
FOR i = 0 TO 7
  POKE USR "a" + i, $F0 + i
NEXT i
PRINT AT 6, 0; CHR$ 144;
CHK("udg", Cd(SCREEN$(6, 0)), "144")  : REM UDGs match against the redefined table

REM plotted pixel over a letter (cell row 7: pixel y 192-199 from the bottom
REM is text row 24 - 7 = 17 rows up -> y = 8 * (24 - 7) = 136..143)
PRINT AT 7, 0; "D";
REM x = 7 is the glyph's blank right column, so the pixel changes the cell
PLOT 7, 143
CHK("plotted", Cd(SCREEN$(7, 0)), "none")

REM out of range
CHK("col40_mode1", Cd(SCREEN$(2, 40)), "none")
CHK("col39_mode1", Cd(SCREEN$(2, 39)), "32")
CHK("row25", Cd(SCREEN$(25, 0)), "none")
CHK("row24", Cd(SCREEN$(24, 0)), "32")

REM cursor unchanged
PRINT AT 9, 7;
DIM s$ AS STRING
s$ = SCREEN$(2, 0)
CHK("cursor_row", STR$(CSRLIN()), "9")
CHK("cursor_col", STR$(POS()), "7")
s$ = SCREEN$(2, 40)
CHK("cursor_row_oor", STR$(CSRLIN()), "9")
CHK("cursor_col_oor", STR$(POS()), "7")

REM mode 0
Mode 0
CLS
PRINT AT 1, 19; "Z";
CHK("mode0_col19", Cd(SCREEN$(1, 19)), "90")
CHK("mode0_col20", Cd(SCREEN$(1, 20)), "none")

REM mode 2
Mode 2
CLS
PRINT AT 1, 79; "Y";
CHK("mode2_col79", Cd(SCREEN$(1, 79)), "89")
CHK("mode2_col80", Cd(SCREEN$(1, 80)), "none")

Mode 1
CLS
PRINT
PRINT results$; "DONE"
END
