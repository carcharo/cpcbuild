REM Screen test (CPC Plus, Phase 7 P2): the sixteen pens of mode 0 as 12-bit colours from
REM an img2cpc.py --plus-palette include (tests/conformance/assets/plus_bars.png, none of the
REM sixteen is one of the CPC's 27 colours), loaded with SetPalette12Block, a 12-bit border,
REM then one pen changed with SetPalette12 and one from GetPalette12's value; firmware text
REM (PRINT) still drawn in its pens. Waits 60 frames first (see plus_sprites.bas).
REM Without an ASIC (the chips 464/6128 goldens) the pens keep the firmware's colours.
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/fill.bas>
#include <cpcplus/cpcplus.bas>
#include "../conformance/assets/plus_bars.bas"
#include "lib/shot.bas"

DIM p AS UBYTE
Mode 0
ScreenInit()
CLS
FOR p = 0 TO 15
  FillRect(p * 5, 20, 5, 90, p)
  FillRect(p * 5, 110, 5, 90, 15 - p)
NEXT p
REM pens 14 and 15 flash in the firmware's default palette (and not in a bare build): make
REM them steady first so the goldens without an ASIC are the same in both modes
SetInk(14, 6)
SetInk(15, 18)
SetPalette12Block(@plusbars_pal(0), 0, 16)
SetBorder12($0C80)
SetPalette12(3, $0FFF)
SetPalette12(4, GetPalette12(13))
PRINT AT 0, 0; "12-BIT PENS"
WaitRetrace(60)
Shot("plus_palette12")
