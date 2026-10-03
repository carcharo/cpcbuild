REM BARE: skip calls the firmware directly (GRA_TEST_ABSOLUTE reference, SCR_GET_LOCATION scroll offset)
REM Conformance: cpcbuild fill (Phase 4c) -- PenByte against the firmware's
REM SCR_INK_ENCODE in modes 0, 1 and 2, FillRect (clipping on every edge,
REM rows that wrap with a hardware-scroll offset), ClearScreen.
REM
REM Library coordinates: x in bytes (0-79), y in pixel lines (0-199) from
REM the top-left; checked with PeekScreen, and with POINT (mode pixels
REM from the bottom-left) where an independent view is wanted.

#include <point.bas>
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/fill.bas>

DIM results$ AS STRING
DIM tallv, tallp AS UINTEGER
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

REM SCR_INK_ENCODE (&BC2C): A = pen -> A = the byte with every pixel in it.
FUNCTION EncodeFw(pen AS UBYTE) AS UBYTE
  ASM
  ld a, (ix+5)
  call .core.__FW_CALL
  defw $BC2C
  END ASM
END FUNCTION

REM The firmware's scroll offset (SCR_GET_LOCATION -> HL).
FUNCTION FASTCALL ScrollOffset AS UINTEGER
  ASM
  call .core.__FW_CALL
  defw $BC0B
  END ASM
END FUNCTION

REM How many screen bytes equal v, over the whole screen (in asm: a BASIC
REM loop over 16000 PeekScreen calls takes seconds).
FUNCTION CountEq(v AS UBYTE) AS UINTEGER
  ASM
  push namespace core
  PROC
  LOCAL CE_ROW, CE_COL, CE_SKIP
  exx
  ld hl, 0                ; HL' = count
  exx
  ld b, 0                 ; y
CE_ROW:
  ld c, 0
  call __CB_ADDR          ; HL = start of line y
  ld e, (ix+5)
  ld c, 80
CE_COL:
  ld a, (hl)
  cp e
  jr nz, CE_SKIP
  exx
  inc hl
  exx
CE_SKIP:
  call __CB_INC_X
  dec c
  jr nz, CE_COL
  inc b
  ld a, b
  cp 200
  jr nz, CE_ROW
  exx
  push hl
  exx
  pop hl
  ENDP
  pop namespace
  END ASM
END FUNCTION

REM How many bytes in the box x0..x1, y0..y1 (clipped) equal v.
FUNCTION CountBox(x0 AS UBYTE, y0 AS UBYTE, x1 AS UBYTE, y1 AS UBYTE, v AS UBYTE) AS UINTEGER
  DIM x, y AS UBYTE
  DIM n AS UINTEGER = 0
  FOR y = y0 TO y1
    FOR x = x0 TO x1
      IF PeekScreen(x, y) = v THEN n = n + 1
    NEXT x
  NEXT y
  RETURN n
END FUNCTION

REM PenByte vs the firmware, every pen of the mode; returns the mismatches.
FUNCTION PenCheck(npens AS UBYTE) AS UINTEGER
  DIM p AS UBYTE
  DIM bad AS UINTEGER = 0
  FOR p = 0 TO npens - 1
    IF PenByte(p) <> EncodeFw(p) THEN bad = bad + 1
  NEXT p
  RETURN bad
END FUNCTION

DIM i AS UBYTE
DIM off AS UINTEGER
DIM wr, k AS INTEGER

REM --- PenByte against SCR_INK_ENCODE, all pens, all modes ---
Mode 0
ScreenInit()
CHK("penbyte_mode0_all16", STR$(PenCheck(16)), "0")
CHK("penbyte_mode0_masked", STR$(PenByte(16 + 5) = PenByte(5)), "1")
Mode 1
ScreenInit()
CHK("penbyte_mode1_all4", STR$(PenCheck(4)), "0")
CHK("penbyte_mode1_masked", STR$(PenByte(4 + 2) = PenByte(2)), "1")
Mode 2
ScreenInit()
CHK("penbyte_mode2_all2", STR$(PenCheck(2)), "0")
CHK("penbyte_mode2_masked", STR$(PenByte(3) = PenByte(1)), "1")

REM --- mode 1: FillRect ---
Mode 1
ScreenInit()
CLS
CHK("clear_start", STR$(CountEq(0)), "16000")
REM Pen 2 in mode 1 is &0F.
CHK("penbyte_m1_pen2", STR$(PenByte(2)), "15")
FillRect(10, 20, 5, 6, 2)
CHK("fill_inside_count", STR$(CountEq(15)), "30")
CHK("fill_inside_box", STR$(CountBox(10, 20, 14, 25, 15)), "30")
CHK("fill_pixels_pen", STR$(POINT(10 * 4, 199 - 20)) + "," + STR$(POINT(14 * 4 + 3, 199 - 25)), "2,2")
CHK("fill_outside_left", STR$(POINT(10 * 4 - 1, 199 - 20)), "0")
CHK("fill_outside_below", STR$(POINT(10 * 4, 199 - 26)), "0")
REM left/top clip: visible x 0-2, y 0-2
CLS
FillRect(-3, -2, 6, 5, 3)
CHK("clip_topleft_count", STR$(CountEq(255)), "9")
CHK("clip_topleft_box", STR$(CountBox(0, 0, 2, 2, 255)), "9")
REM right/bottom clip: visible x 78-79, y 197-199
CLS
FillRect(78, 197, 5, 5, 3)
CHK("clip_botright_count", STR$(CountEq(255)), "6")
CHK("clip_botright_box", STR$(CountBox(78, 197, 79, 199, 255)), "6")
REM one edge at a time
CLS
FillRect(-2, 100, 4, 3, 1)
CHK("clip_left_only", STR$(CountEq(240)), "6")
CLS
FillRect(77, 100, 6, 3, 1)
CHK("clip_right_only", STR$(CountEq(240)), "9")
CLS
FillRect(40, -3, 2, 5, 1)
CHK("clip_top_only", STR$(CountEq(240)), "4")
CLS
FillRect(40, 198, 2, 5, 1)
CHK("clip_bottom_only", STR$(CountEq(240)), "4")
REM exactly one byte visible at each corner
CLS
FillRect(-3, -3, 4, 4, 3)
FillRect(79, -3, 4, 4, 3)
FillRect(-3, 199, 4, 4, 3)
FillRect(79, 199, 4, 4, 3)
CHK("clip_four_corners", STR$(CountEq(255)), "4")
CHK("clip_four_corners_where", STR$(PeekScreen(0, 0) + PeekScreen(79, 0) + PeekScreen(0, 199) + PeekScreen(79, 199)) , STR$(4 * 255))
REM fully off the screen: nothing
CLS
FillRect(-4, 10, 4, 5, 3)
FillRect(80, 10, 4, 5, 3)
FillRect(10, -5, 4, 5, 3)
FillRect(10, 200, 4, 5, 3)
FillRect(-32768, 10, 200, 5, 3)
FillRect(32767, 10, 200, 5, 3)
FillRect(10, -32768, 4, 255, 3)
FillRect(10, 32767, 4, 255, 3)
FillRect(10, 10, 0, 5, 3)
FillRect(10, 10, 4, 0, 3)
CHK("offscreen_nothing", STR$(CountEq(0)), "16000")
REM a rectangle bigger than the screen covers it all
FillRect(-100, -30, 255, 255, 3)
CHK("bigger_than_screen", STR$(CountEq(255)), "16000")
CLS
REM clearing: a rectangle covering one whole line, 80 wide
FillRect(0, 50, 80, 1, 2)
CHK("fill_full_line", STR$(CountEq(15)), "80")

REM a tall fill crossing character rows and 2 KB blocks (the no-wrap fast loop)
CLS
FillRect(11, 5, 30, 60, 2)
tallv = CountEq(15)
tallp = POINT(11 * 4, 199 - 5) + POINT(40 * 4 + 3, 199 - 64) + POINT(10 * 4 + 3, 199 - 30) + POINT(41 * 4, 199 - 30) + POINT(20 * 4, 199 - 65) + POINT(20 * 4, 199 - 4)
CLS
FillRect(0, 3, 80, 197, 1)
CHK("tall", STR$(tallv) + "," + STR$(tallp) + "," + STR$(CountEq(240)), "1800,4,15760")

REM --- ClearScreen ---
ClearScreen(2)
CHK("clearscreen_pen2_mode1", STR$(CountEq(15)), "16000")
CHK("clearscreen_pen2_pixels", STR$(POINT(0, 0)) + STR$(POINT(319, 199)) + STR$(POINT(160, 100)), "222")
ClearScreen(0)
CHK("clearscreen_pen0", STR$(CountEq(0)), "16000")
ClearScreen(3)
CHK("clearscreen_pen3_pixels", STR$(POINT(0, 0)) + STR$(POINT(319, 199)), "33")
CHK("clearscreen_pen3_count", STR$(CountEq(255)), "16000")
REM FillRect with one-byte-wide rows (the LDIR guard)
ClearScreen(0)
FillRect(5, 5, 1, 7, 1)
CHK("fill_one_wide", STR$(CountEq(240)), "7")

REM --- mode 0 and 2 ---
Mode 0
ScreenInit()
CLS
FillRect(3, 4, 6, 5, 9)
CHK("fill_mode0_count", STR$(CountEq(PenByte(9))), "30")
CHK("fill_mode0_pixels", STR$(POINT(3 * 2, 199 - 4)) + "," + STR$(POINT(8 * 2 + 1, 199 - 8)) + "," + STR$(POINT(3 * 2 - 1, 199 - 4)), "9,9,0")
ClearScreen(13)
CHK("clearscreen_mode0", STR$(CountEq(PenByte(13))), "16000")
CHK("clearscreen_mode0_pixels", STR$(POINT(0, 0)) + "," + STR$(POINT(159, 199)), "13,13")
Mode 2
ScreenInit()
CLS
FillRect(70, 190, 20, 20, 1)
CHK("fill_mode2_clipped", STR$(CountEq(255)), "90")
ClearScreen(1)
CHK("clearscreen_mode2", STR$(CountEq(255)), "16000")
CHK("clearscreen_mode2_pixel", STR$(POINT(639, 0)), "1")
ClearScreen(0)
CHK("clearscreen_mode2_pen0", STR$(CountEq(0)), "16000")

REM --- hardware-scroll offset: rows that wrap around their 2 KB block ---
Mode 1
ScreenInit()
CLS
FOR i = 1 TO 30
  PRINT i
NEXT i
ScreenInit()
CLS
FOR i = 1 TO 30
  PRINT i
NEXT i
ScreenInit()
CLS
off = ScrollOffset()
CHK("scroll_offset_set", STR$(off > 0), "1")
wr = (2048 - off) / 80
k = (2048 - off) - wr * 80
CHK("scroll_wraps_in_row", STR$(k > 0 AND wr <= 24), "1")
IF k > 0 AND wr <= 24 THEN
  DIM y0 AS INTEGER
  DIM xa AS INTEGER
  y0 = wr * 8 + 2
  xa = k - 10
  IF xa < 0 THEN xa = 0
  REM 20 bytes wide, 4 lines, crossing the wrap point k
  FillRect(xa, y0, 20, 4, 3)
  CHK("wrap_fill_count", STR$(CountEq(255)), "80")
  CHK("wrap_fill_box", STR$(CountBox(xa, y0, xa + 19, y0 + 3, 255)), "80")
  CHK("wrap_fill_pixels", STR$(POINT((k - 1) * 4 + 1, 199 - y0)) + STR$(POINT(k * 4 + 1, 199 - y0)) + STR$(POINT(xa * 4 - 1, 199 - y0)) + STR$(POINT((xa + 20) * 4 + 1, 199 - y0)), "3300")
  REM a full 80-byte row through the wrap, and the next row down
  CLS
  FillRect(0, y0, 80, 2, 1)
  CHK("wrap_fill_full_row", STR$(CountEq(240)), "160")
  CHK("wrap_fill_full_pixels", STR$(POINT(0, 199 - y0)) + STR$(POINT(k * 4, 199 - y0)) + STR$(POINT(319, 199 - y0 - 1)), "111")
  CLS
  FillRect(k, y0, 1, 3, 2)
  CHK("wrap_fill_one_wide", STR$(CountEq(15)), "3")
  CHK("wrap_fill_one_wide_px", STR$(POINT(k * 4, 199 - y0)), "2")
END IF
ClearScreen(2)
CHK("clearscreen_with_offset", STR$(CountEq(15)), "16000")
CHK("clearscreen_offset_pixels", STR$(POINT(0, 0)) + STR$(POINT(319, 199)) + STR$(POINT(100, 100)), "222")

PRINT AT 0, 0;
PRINT results$; "DONE"
END
