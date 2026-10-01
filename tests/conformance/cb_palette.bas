REM Conformance: cpcbuild palette (Phase 4c) -- the firmware's ink and
REM border tables after SetPalette, PalUpload, SetInk and SetBorder
REM (SCR_GET_INK / SCR_GET_BORDER), range handling, and that drawing
REM still works. What shows on the real screen (the Gate Array side) is
REM checked by tools/palette_check.py through screenshots, not here.

#include <cpc.bas>
#include <point.bas>
#include <screen.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/palette.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

REM SCR_GET_INK (&BC35): A = pen -> B = first ink, C = second ink.
FUNCTION FASTCALL GetInk1(pen AS UBYTE) AS UBYTE
  ASM
  call .core.__FW_CALL
  defw $BC35
  ld a, b
  END ASM
END FUNCTION
FUNCTION FASTCALL GetInk2(pen AS UBYTE) AS UBYTE
  ASM
  call .core.__FW_CALL
  defw $BC35
  ld a, c
  END ASM
END FUNCTION
REM SCR_GET_BORDER (&BC3B): B, C = the border inks.
FUNCTION GetBorder1 AS UBYTE
  ASM
  call .core.__FW_CALL
  defw $BC3B
  ld a, b
  END ASM
END FUNCTION

DIM p(15) AS UBYTE
DIM i AS UBYTE
DIM before5, before7, before11 AS UBYTE
DIM s$ AS STRING

Mode 1
ScreenInit()

REM --- SetPalette: pens 0..count-1 ---
before5 = GetInk1(4)
before7 = GetInk1(7)
before11 = GetInk1(11)
p(0) = 5: p(1) = 10: p(2) = 15: p(3) = 20
SetPalette(@p(0), 4)
CHK("setpalette_0", STR$(GetInk1(0)), "5")
CHK("setpalette_1", STR$(GetInk1(1)), "10")
CHK("setpalette_2", STR$(GetInk1(2)), "15")
CHK("setpalette_3", STR$(GetInk1(3)), "20")
CHK("setpalette_not_flashing", STR$(GetInk2(1)), "10")
CHK("setpalette_pen4_untouched", STR$(GetInk1(4)), STR$(before5))

REM --- PalUpload: pens first..first+count-1 ---
p(0) = 1: p(1) = 26: p(2) = 13
PalUpload(@p(0), 3, 8)
CHK("palupload_8", STR$(GetInk1(8)), "1")
CHK("palupload_9", STR$(GetInk1(9)), "26")
CHK("palupload_10", STR$(GetInk1(10)), "13")
CHK("palupload_pen7_untouched", STR$(GetInk1(7)), STR$(before7))
CHK("palupload_pen11_untouched", STR$(GetInk1(11)), STR$(before11))

REM --- SetInk / SetBorder ---
SetInk(2, 24)
CHK("setink_a", STR$(GetInk1(2)), "24")
CHK("setink_b", STR$(GetInk2(2)), "24")
SetBorder(7)
CHK("setborder", STR$(GetBorder1()), "7")
SetBorder(9)
CHK("setborder_again", STR$(GetBorder1()), "9")
SetInk(16, 20)
CHK("setink_pen16_ignored_border", STR$(GetBorder1()), "9")
CHK("setink_pen16_ignored_pen0", STR$(GetInk1(0)), "5")

REM --- range handling: colour above 26, pens above 15, count 0 ---
SetInk(1, 30)
CHK("setink_bad_colour_ignored", STR$(GetInk1(1)), "10")
SetBorder(40)
CHK("setborder_bad_colour_ignored", STR$(GetBorder1()), "9")
p(0) = 2: p(1) = 3: p(2) = 4: p(3) = 5: p(4) = 6
PalUpload(@p(0), 5, 14)
CHK("palupload_pen14", STR$(GetInk1(14)), "2")
CHK("palupload_pen15", STR$(GetInk1(15)), "3")
CHK("palupload_stops_at_15_border", STR$(GetBorder1()), "9")
PalUpload(@p(0), 0, 0)
CHK("count_0_nothing", STR$(GetInk1(0)), "5")
p(0) = 99: p(1) = 12
PalUpload(@p(0), 2, 5)
CHK("bad_entry_skipped_pen5", STR$(GetInk1(5) <> 99), "1")
CHK("good_entry_after_bad_pen6", STR$(GetInk1(6)), "12")

REM --- the firmware keeps what was set after its own frame work ran ---
WaitRetrace(3)
CHK("kept_after_frames", STR$(GetInk1(2)) + " " + STR$(GetBorder1()), "24 9")

REM --- drawing still works, with the new palette ---
SetInk(0, 0): SetInk(1, 26): SetInk(2, 6): SetInk(3, 18)
CLS
PokeScreen(5, 5, $FF)
CHK("poke_after_palette", STR$(POINT(22, 194)), "3")
PLOT 100, 100
CHK("plot_after_palette", STR$(POINT(100, 100) <> 0), "1")
PRINT AT 3, 3; "hello"
CHK("print_after_palette", SCREEN$(3, 3), "h")

REM Back to the firmware's defaults for this mode, so the results print
REM readably: blue paper, yellow ink, blue border.
SetInk(0, 1): SetInk(1, 24): SetInk(2, 20): SetInk(3, 6)
SetBorder(1)
CLS
PRINT results$; "DONE"
END
