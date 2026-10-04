REM Screen test (CPC Plus, Phase 7 P3): split screen and soft scroll. Mode 1, four 12-bit
REM pens. Two screens are drawn with cpcbuild's double buffering (the shown one at &C000,
REM the hidden one at &4000), then the CRTC is left showing &C000 and the ASIC's split
REM screen is set to switch to &4000 at line 96 (a character row boundary), and the
REM soft scroll to 5 mode-2 pixels right, 3 lines up, with the border extended.
REM The top half: pen bars and text of the &C000 screen scrolled; the bottom half: the
REM top of the &4000 screen (diagonal-ish stripes, a frame), scrolled the same way.
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/fill.bas>
#include <cpcplus/cpcplus.bas>
#include "lib/shot.bas"

DIM i AS UBYTE
Mode 1
ScreenInit()
CLS
SetPalette12(0, $0124)
SetPalette12(1, $0FE6)
SetPalette12(2, $0C3A)
SetPalette12(3, $03DB)
SetBorder12($0F73)
IF PlusAvailable() = 0 THEN
  PRINT AT 1, 1; "NO PLUS"
END IF

REM the hidden screen at &4000: a frame and stripes
EnableDoubleBuffer()
FillRect(0, 0, 80, 200, 0)
FillRect(0, 0, 80, 4, 2)
FillRect(0, 196, 80, 4, 2)
FillRect(0, 0, 4, 200, 2)
FillRect(76, 0, 4, 200, 2)
FOR i = 0 TO 9
  FillRect(8 + i * 7, 8 + i * 6, 6, 40, 1 + (i MOD 3))
NEXT i
DisableDoubleBuffer()

REM the shown screen at &C000: three bars and a title
FillRect(0, 0, 80, 200, 0)
FillRect(0, 0, 80, 12, 3)
FillRect(0, 12, 40, 80, 1)
FillRect(40, 12, 40, 80, 2)
FillRect(0, 92, 80, 4, 3)
FillRect(30, 40, 20, 24, 3)
PRINT AT 2, 2; "PLUS SPLIT + SOFT SCROLL"
PRINT AT 6, 2; "TOP: SCREEN AT C000"

SplitScreen(96, $4000)
ScrollFine(5, 3)
ScrollBorder(1)
WaitRetrace(60)
Shot("plus_splitscroll")
