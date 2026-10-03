REM Conformance: text output and its pixels (runs in firmware and bare mode).
REM
REM The pixels are read straight from screen memory (&C000, 80 bytes per
REM character row, pixel lines &800 apart): both modes draw the same bytes.
REM A glyph row is expanded per mode: mode 2 one byte, mode 1 two, mode 0
REM four; the ink and paper are pens of the mode (colour.asm's pen map).

#include <cpc.bas>
#include <pos.bas>
#include <csrlin.bas>
#include <screen.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

REM Screen byte n (0-based) of pixel line y (0-7) of text cell (row, col),
REM given the bytes per cell.
FUNCTION Cell(row AS UBYTE, col AS UBYTE, bpc AS UBYTE, y AS UBYTE, n AS UBYTE) AS STRING
  DIM a AS UINTEGER
  a = $C000 + CAST(UINTEGER, y) * 2048 + CAST(UINTEGER, row) * 80 + CAST(UINTEGER, col) * bpc + n
  RETURN STR$(PEEK(a))
END FUNCTION

REM Code of the char, or "none"
FUNCTION Cd(s AS STRING) AS STRING
  IF LEN(s) = 0 THEN RETURN "none"
  RETURN STR$(CODE(s))
END FUNCTION

DIM y AS UBYTE
DIM s AS STRING

REM --- mode 2: ink 7 = pen 1, paper 0 = pen 0: the glyph byte itself ---
Mode 2
PRINT AT 0, 0; "A";
s = ""
FOR y = 0 TO 7
  s = s + Cell(0, 0, 1, y, 0) + ","
NEXT y
CHK("mode2_A", s, "24,60,102,102,126,102,102,0,")
PRINT AT 1, 0; INVERSE 1; "A";
s = ""
FOR y = 0 TO 7
  s = s + Cell(1, 0, 1, y, 0) + ","
NEXT y
CHK("mode2_A_inverse", s, "231,195,153,153,129,153,153,255,")
PRINT AT 2, 79; "B";
CHK("mode2_last_col_B", Cell(2, 79, 1, 0, 0), "252")

REM --- mode 1: pen 1 on pen 0: a glyph nibble n -> n << 4 per byte ---
Mode 1
PRINT AT 0, 0; "A";
s = ""
FOR y = 0 TO 7
  s = s + Cell(0, 0, 2, y, 0) + "/" + Cell(0, 0, 2, y, 1) + ","
NEXT y
CHK("mode1_A", s, "16/128,48/192,96/96,96/96,112/224,96/96,96/96,0/0,")
PRINT AT 1, 0; INVERSE 1; "A";
CHK("mode1_A_inverse_row0", Cell(1, 0, 2, 0, 0) + "/" + Cell(1, 0, 2, 0, 1), "224/112")
PRINT AT 2, 0; PAPER 2; INK 4; "A";
REM paper 2 = pen 3 (&FF in mode 1), ink 4 = pen 2 (&0F): row 0 of A
CHK("mode1_A_pens_row0", Cell(2, 0, 2, 0, 0) + "/" + Cell(2, 0, 2, 0, 1), "239/127")
PRINT AT 3, 0; PAPER 0; INK 7;

REM --- mode 0: 4 bytes per cell ---
Mode 0
PRINT AT 0, 0; "A";
REM ink 7 = pen 4 (mask &30), paper 0 = pen 5 (mask &F0)
s = Cell(0, 0, 4, 0, 0) + "/" + Cell(0, 0, 4, 0, 1) + "/" + Cell(0, 0, 4, 0, 2) + "/" + Cell(0, 0, 4, 0, 3)
REM row 0 of A is &18 = 00 01 10 00: pairs 0, 1, 2, 0
REM pair 0 -> paper both = &F0; pair 1 (right pixel ink) = &F0 xor (&55 and &C0) = &B0;
REM pair 2 (left pixel ink) = &F0 xor (&AA and &C0) = &70
CHK("mode0_A_row0", s, "240/176/112/240")
PRINT AT 24, 19; "Z";
CHK("mode0_last_col_Z", Cell(24, 19, 4, 0, 0) + "/" + Cell(24, 19, 4, 0, 3), "48/112")
Mode 1

REM --- the cursor: wrap, newline, scroll, AT, CLS ---
CLS
PRINT AT 0, 39; "ab";
CHK("wrap_char", Cd(SCREEN$(1, 0)) , "98")
CHK("wrap_pos", STR$(CSRLIN()) + "," + STR$(POS()), "1,1")
PRINT AT 5, 39; "c";
CHK("pending_wrap_pos", STR$(CSRLIN()) + "," + STR$(POS()), "6,0")
PRINT AT 10, 0; "row10";
PRINT AT 24, 0; "last";
PRINT
REM a line feed on the last row only moves the cursor below the screen ...
CHK("scroll_pending_cursor", STR$(CSRLIN()) + "," + STR$(POS()), "25,0")
CHK("not_scrolled_yet", Cd(SCREEN$(24, 0)), "108")
REM ... the next character scrolls first
PRINT "z";
CHK("scroll_cursor", STR$(CSRLIN()) + "," + STR$(POS()), "24,1")
CHK("scrolled_last", Cd(SCREEN$(23, 0)), "108")
CHK("scrolled_z", Cd(SCREEN$(24, 0)), "122")
CHK("scrolled_row10", Cd(SCREEN$(9, 0)), "114")
CHK("scrolled_new_row_blank", Cd(SCREEN$(24, 1)), "32")
PRINT
PRINT
CHK("double_lf_cursor", STR$(CSRLIN()) + "," + STR$(POS()), "25,0")
CHK("double_lf_z", Cd(SCREEN$(23, 0)), "122")
CHK("double_lf_last", Cd(SCREEN$(22, 0)), "108")
CLS
CHK("cls_home", STR$(CSRLIN()) + "," + STR$(POS()), "0,0")
PAPER 2
CLS
CHK("cls_paper2_byte", Cell(0, 0, 2, 0, 0) + "/" + Cell(24, 39, 2, 7, 1), "255/255")
PAPER 0
CLS
PRINT AT 3, 5; "x"; TAB 12; "y"; ,"z";
CHK("tab_y", Cd(SCREEN$(3, 12)), "121")
CHK("comma_z", Cd(SCREEN$(3, 20)), "122")
CHK("pos_after", STR$(POS()), "21")
CLS

REM --- SCREEN$ round trip, every printable character ---
DIM c AS UBYTE
DIM bad AS UINTEGER = 0
FOR c = 32 TO 126
  PRINT AT 4 + (c - 32) / 40, (c - 32) MOD 40; CHR$ c;
NEXT c
FOR c = 32 TO 126
  IF CODE(SCREEN$(4 + (c - 32) / 40, (c - 32) MOD 40)) <> c THEN bad = bad + 1
NEXT c
CHK("screen_roundtrip_ascii", STR$(bad), "0")
CLS

REM --- the runtime error path draws on the screen too (error.asm's __ERR_SCR) ---
PRINT AT 5, 0;
ASM
  ld a, 69
  call .core.__ERR_SCR
  ld a, 114
  call .core.__ERR_SCR
  ld a, 13
  call .core.__ERR_SCR
  ld a, 10
  call .core.__ERR_SCR
  ld a, 33
  call .core.__ERR_SCR
END ASM
CHK("err_scr_E", Cd(SCREEN$(5, 0)), "69")
CHK("err_scr_r", Cd(SCREEN$(5, 1)), "114")
CHK("err_scr_crlf_bang", Cd(SCREEN$(6, 0)), "33")
CLS

PRINT results$; "DONE"
END

