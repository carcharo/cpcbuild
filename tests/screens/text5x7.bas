REM Screen test: cpcbuild/text.bas -- Starfall's 5x7 font (games/shooter/assets/font.bas,
REM shifted left 3 into the library's format: bit 7 the leftmost pixel) in mode 0:
REM several pens, ink on paper, text cut off at the right edge, characters outside the
REM font, rows below a short glyph, a 4-row font with 8-pixel glyphs; then double
REM buffering (TextAtBoth + FlipBuffer + TextFlush: three shots, the two screens and
REM the first again; text queued in the pens it was queued with, strings that don't
REM fit the queue left on one screen only); then mode 1, and back to mode 0.
#include <cpc.bas>
#include <cpcbuild.bas>
#include "../../games/shooter/assets/font.bas"
#include "lib/shot.bas"

DIM ft(font_COUNT * 7 - 1) AS UBYTE
DIM tiny(7) AS UBYTE => {$FF, $81, $81, $FF, $AA, $55, $AA, $55}
DIM i AS UINTEGER

REM the game's glyphs have bit 4 leftmost; the library wants bit 7
FOR i = 0 TO font_COUNT * 7 - 1
  ft(i) = font(i) << 3
NEXT i

Mode 0
ScreenInit()
BORDER 0
TextFont(@ft(0), font_FIRST, 7, font_FIRST + font_COUNT - 1)

REM pens 1-7 on paper 0, then ink on paper
TextPen(1, 0): TextAt(0, 0, "STARFALL 0123456789")
TextPen(2, 0): TextAt(0, 1, "PEN 2 ABCDEFGHIJKLM")
TextPen(3, 0): TextAt(0, 2, "PEN 3 NOPQRSTUVWXYZ")
TextPen(7, 0): TextAt(0, 3, "PEN 7 -.:;<=>?@/")
TextPen(13, 6): TextAt(0, 5, "13 ON 6 SCORE 00450")  ' not 14 or 15: they flash under the firmware, not in bare builds
TextPen(0, 9): TextAt(0, 6, "0 ON 9 HI 99999")
TextPen(12, 4): TextAt(0, 7, "12 ON 4 LIVES")
REM characters outside the font (lower case, space below '-', ! # $ % &) are paper
TextPen(1, 3): TextAt(0, 9, "AB abc !#$ XY~Z")
REM cut off at the right edge, and not drawn at all past it
TextPen(1, 0)
TextAt(16, 11, "CUT OFF HERE")
TextAt(19, 12, "ZZZZ")
TextAt(20, 13, "NOT SEEN")
TextAt(0, 25, "NOT SEEN")
TextAt(0, 24, "LAST ROW")
TextAt(5, 14, "")
REM a four-row font, 8 pixels wide: glyph 0 is a box, glyph 1 a checker
TextFont(@tiny(0), 48, 4, 49)
TextPen(1, 2): TextAt(0, 16, "0101001")
TextPen(3, 0): TextAt(8, 16, "10")
TextFont(@ft(0), font_FIRST, 7, font_FIRST + font_COUNT - 1)
TextPen(2, 0): TextAt(8, 18, "BACK ")
Shot("text5x7_m0")

REM double buffering: text drawn now on the back screen, queued for the other
Mode 0
ScreenInit()
BORDER 0
EnableDoubleBuffer()
TextFont(@ft(0), font_FIRST, 7, font_FIRST + font_COUNT - 1)
REM both screens cleared to pen 0, and back to drawing on the first
ClearScreen(0)
FlipBuffer()
ClearScreen(0)
FlipBuffer()
TextPen(1, 0)
TextAtBoth(2, 1, "BOTH SCREENS")
TextAt(2, 3, "ONE SCREEN")
TextPen(2, 0)
TextAtBoth(2, 5, "PEN 2 QUEUED")
TextPen(3, 0)
REM the queue holds 160 bytes, an entry is 4 + the length: BOTH SCREENS (16) and
REM PEN 2 QUEUED (16), then 19-character rows (23 each): rows 7-11 fit (147 bytes
REM in all), rows 12-14 are drawn now but not queued, so they stay on one screen
TextAtBoth(0, 7, "ROW 7 FITS.........")
TextAtBoth(0, 8, "ROW 8 FITS.........")
TextAtBoth(0, 9, "ROW 9 FITS.........")
TextAtBoth(0, 10, "ROW 10 FITS........")
TextAtBoth(0, 11, "ROW 11 FITS........")
TextAtBoth(0, 12, "ROW 12 NOT QUEUED..")
TextAtBoth(0, 13, "ROW 13 NOT QUEUED..")
TextAtBoth(0, 14, "ROW 14 NOT QUEUED..")
TextPen(7, 0)
FlipBuffer()
TextFlush()
Shot("text5x7_dbl_a")
FlipBuffer()
TextFlush()
Shot("text5x7_dbl_b")
REM TextFlush put the pens back (7 on 0): a text now, on the hidden screen, then show it
TextAt(2, 20, "PEN 7 AFTER FLUSH")
FlipBuffer()
TextFlush()
Shot("text5x7_dbl_c")

REM mode 1: 40 x 25 cells
DisableDoubleBuffer()
Mode 1
ScreenInit()
BORDER 0
TextFont(@ft(0), font_FIRST, 7, font_FIRST + font_COUNT - 1)
TextPen(1, 0): TextAt(0, 0, "MODE 1 STARFALL 0123456789 ABCDEFGHIJKLM")
TextPen(2, 0): TextAt(0, 1, "PEN 2 NOPQRSTUVWXYZ -.:;<=>?@/")
TextPen(3, 0): TextAt(0, 2, "PEN 3 THE QUICK BROWN FOX")
TextPen(3, 1): TextAt(0, 4, "3 ON 1 SCORE 00450")
TextPen(0, 2): TextAt(0, 5, "0 ON 2 HI 99999")
TextPen(1, 3): TextAt(0, 7, "AB abc !#$ XY~Z outside the font")
TextPen(1, 0)
TextAt(36, 10, "CUT OFF HERE")
TextAt(39, 11, "ZZZZ")
TextAt(40, 12, "NOT SEEN")
TextAt(0, 24, "LAST ROW")
TextFont(@tiny(0), 48, 4, 49)
TextPen(1, 2): TextAt(0, 14, "0101001")
TextPen(3, 0): TextAt(8, 14, "10")
REM double buffering is off: TextAtBoth is TextAt, and TextFlush has nothing to draw
TextFont(@ft(0), font_FIRST, 7, font_FIRST + font_COUNT - 1)
TextPen(2, 0)
TextAtBoth(0, 20, "BOTH, DOUBLE BUFFERING OFF")
TextFlush()
TextPen(3, 0)
Shot("text5x7_m1")

REM back to mode 0 without calling TextPen: the pens (3 on 0) come back in mode 0
Mode 0
ScreenInit()
BORDER 0
TextFont(@ft(0), font_FIRST, 7, font_FIRST + font_COUNT - 1)
TextAt(0, 2, "MODE 0 AGAIN PEN 3")
TextAt(0, 3, "NO TEXTPEN CALL")
Shot("text5x7_switch")
