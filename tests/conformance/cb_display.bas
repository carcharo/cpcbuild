REM Conformance: cpcbuild core (Phase 4c) -- screen addressing with and
REM without a hardware-scroll offset, double buffering, WaitRetrace.
REM
REM Library coordinates: x in bytes (0-79), y in pixel lines (0-199) from
REM the top-left. In mode 1 a byte is 4 pixels; &FF is 4 pixels of pen 3.
REM Pixels are checked with POINT (mode pixels from the bottom-left), so
REM byte (x, y) covers POINT(4x .. 4x+3, 199 - y).

#include <point.bas>
#include <cpcbuild/display.bas>

DIM results$ AS STRING
SUB CHK(name AS STRING, gotv AS STRING, wantv AS STRING)
  IF gotv = wantv THEN
    results$ = results$ + "PASS " + name + CHR$ 13
  ELSE
    results$ = results$ + "FAIL " + name + " got=" + gotv + " want=" + wantv + CHR$ 13
  END IF
END SUB

FUNCTION FASTCALL Ticks AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

REM The firmware's scroll offset (SCR_GET_LOCATION -> HL).
FUNCTION FASTCALL ScrollOffset AS UINTEGER
  ASM
  call .core.__FW_CALL
  defw $BC0B
  END ASM
END FUNCTION

REM Writes &FF at the first byte of every character row and every byte of
REM pixel line y; returns how many of those don't read back right, through
REM PeekScreen and through POINT.
FUNCTION CheckGrid(y AS UBYTE) AS UINTEGER
  DIM r, x AS UBYTE
  DIM bad AS UINTEGER = 0
  FOR r = 0 TO 24
    PokeScreen(0, r * 8 + 3, $FF)
    IF PeekScreen(0, r * 8 + 3) <> $FF THEN bad = bad + 1
    IF POINT(0, 199 - (r * 8 + 3)) <> 3 THEN bad = bad + 1
  NEXT r
  FOR x = 0 TO 79
    PokeScreen(x, y, $FF)
    IF PeekScreen(x, y) <> $FF THEN bad = bad + 1
    IF POINT(x * 4 + 2, 199 - y) <> 3 THEN bad = bad + 1
  NEXT x
  RETURN bad
END FUNCTION

DIM t0 AS ULONG
DIM i AS UBYTE
DIM off AS UINTEGER

REM --- no scroll yet ---
ScreenInit()
CHK("offset_start", STR$(ScrollOffset()), "0")
CHK("grid_no_offset", STR$(CheckGrid(100)), "0")
PokeScreen(79, 199, $FF)
CHK("bottom_right", STR$(POINT(319, 0)), "3")
CHK("bottom_right_left_neighbour", STR$(POINT(315, 0)), "0")
PokeScreen(80, 0, $FF)
CHK("off_screen_x_ignored", STR$(PeekScreen(80, 0)), "0")

REM --- scroll the text so the firmware moves the screen start ---
CLS
FOR i = 1 TO 30
  PRINT i
NEXT i
off = ScrollOffset()
CHK("offset_moved", STR$(off > 0), "1")
ScreenInit()
CLS
REM after CLS the offset may be reset; scroll again so it isn't 0
FOR i = 1 TO 30
  PRINT i
NEXT i
ScreenInit()
CLS
CHK("offset_after_scroll", STR$(ScrollOffset() > 0), "1")
REM The character row whose bytes wrap around the 2 KB block is
REM (2048 - offset) / 80; check a line in it and the whole grid.
off = ScrollOffset()
DIM wraprow AS UBYTE
wraprow = (2048 - off) / 80
IF wraprow > 24 THEN wraprow = 24
CHK("grid_with_offset", STR$(CheckGrid(wraprow * 8 + 5)), "0")

REM --- WaitRetrace: 50 frames = 300 ticks of 1/300 s ---
t0 = Ticks()
WaitRetrace(50)
CHK("waitretrace_50", STR$((Ticks() - t0) >= 294 AND (Ticks() - t0) <= 312), "1")

REM --- double buffering ---
CLS
ScreenInit()
EnableDoubleBuffer()
PokeScreen(10, 50, $FF)
CHK("dbuf_drawn_hidden", STR$(POINT(42, 149)), "0")
FlipBuffer()
CHK("dbuf_shown_after_flip", STR$(POINT(42, 149)), "3")
PokeScreen(20, 60, $FF)
CHK("dbuf_second_hidden", STR$(POINT(82, 139)), "0")
FlipBuffer()
CHK("dbuf_second_shown", STR$(POINT(82, 139)), "3")
CHK("dbuf_first_gone", STR$(POINT(42, 149)), "0")
DisableDoubleBuffer()
CHK("dbuf_off_keeps_frame", STR$(POINT(82, 139)), "3")
PokeScreen(30, 70, $FF)
CHK("dbuf_off_draws_shown", STR$(POINT(122, 129)), "3")

PRINT AT 0, 0;
PRINT results$; "DONE"
END
