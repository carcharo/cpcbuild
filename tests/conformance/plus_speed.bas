REM MODELS: plus
REM Conformance: the cost of the cpcplus calls (Phase 7 speed fixes, Caprice32 only).
REM Each call is made N times in a BASIC loop and timed with Ticks() (300 Hz
REM firmware, 50 Hz * 6 bare: so N is large). The loop's own cost, with a call of
REM an empty SUB of the same signature, is measured the same way, so "net" is
REM what the library routine adds to any BASIC call. Bounds are in microseconds
REM per call (the CPC's 4 MHz with its wait states: Caprice32 emulates them) and
REM are about 1.4 times the measured values (see the header of cpcplus.bas for them and for
REM the costs before the fast paths, which were 2-3 times these bounds).

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#include "lib/ticks.bas"

CONST N AS UINTEGER = 1500

DIM blk(63) AS UBYTE
DIM tbl(63) AS UBYTE
DIM i AS UINTEGER
DIM t0, base3, base2 AS ULONG

SUB Nop2(a AS UBYTE, b AS UINTEGER)
END SUB

SUB Nop3(a AS UBYTE, b AS INTEGER, c AS INTEGER)
END SUB

REM microseconds per call from a tick count over N calls (a tick is 3333 us)
FUNCTION Us(t AS ULONG) AS ULONG
  RETURN (t * 3333) / N
END FUNCTION

PlusUnlock()
SetPalette12(1, $0123)          REM the probe and the first unlock are not timed

t0 = Ticks()
FOR i = 1 TO N
  Nop2(3, $0ABC)
NEXT i
base2 = Ticks() - t0
t0 = Ticks()
FOR i = 1 TO N
  Nop3(3, 200, 100)
NEXT i
base3 = Ticks() - t0
PRINT "info base2 us="; Us(base2); " base3 us="; Us(base3)

t0 = Ticks()
FOR i = 1 TO N
  SetPalette12(3, $0ABC)
NEXT i
t0 = Ticks() - t0
PRINT "info SetPalette12 total us="; Us(t0); " net="; Us(t0 - base2)
CHK("cost_SetPalette12_under_300us", STR$(Us(t0) <= 300), "1")
t0 = Ticks()
FOR i = 1 TO N
  SetBorder12($0ABC)
NEXT i
t0 = Ticks() - t0
PRINT "info SetBorder12 total us="; Us(t0)
CHK("cost_SetBorder12_under_300us", STR$(Us(t0) <= 300), "1")
t0 = Ticks()
FOR i = 1 TO N
  SpriteColour(3, $0ABC)
NEXT i
t0 = Ticks() - t0
PRINT "info SpriteColour total us="; Us(t0); " net="; Us(t0 - base2)
CHK("cost_SpriteColour_under_300us", STR$(Us(t0) <= 300), "1")
t0 = Ticks()
FOR i = 1 TO N
  SpriteMove(3, 200, 100)
NEXT i
t0 = Ticks() - t0
PRINT "info SpriteMove total us="; Us(t0); " net="; Us(t0 - base3)
CHK("cost_SpriteMove_under_300us", STR$(Us(t0) <= 300), "1")
t0 = Ticks()
FOR i = 1 TO N
  SetPalette12Block(@blk(0), 0, 16)
NEXT i
t0 = Ticks() - t0
PRINT "info SetPalette12Block16 total us="; Us(t0)
CHK("cost_SetPalette12Block16_under_750us", STR$(Us(t0) <= 750), "1")
t0 = Ticks()
FOR i = 1 TO N
  SpriteMoveBlock(0, 8, @tbl(0))
NEXT i
t0 = Ticks() - t0
PRINT "info SpriteMoveBlock8 total us="; Us(t0)
CHK("cost_SpriteMoveBlock8_under_700us", STR$(Us(t0) <= 700), "1")
t0 = Ticks()
FOR i = 1 TO N
  SpriteMoveBlock(0, 16, @tbl(0))
NEXT i
t0 = Ticks() - t0
PRINT "info SpriteMoveBlock16 total us="; Us(t0)
CHK("cost_SpriteMoveBlock16_under_1000us", STR$(Us(t0) <= 1000), "1")
t0 = Ticks()
FOR i = 1 TO N
  ScrollFine(3, 2)
NEXT i
t0 = Ticks() - t0
PRINT "info ScrollFine total us="; Us(t0)
CHK("cost_ScrollFine_under_360us", STR$(Us(t0) <= 360), "1")
t0 = Ticks()
FOR i = 1 TO N
  SpriteMag(3, 2, 2)
NEXT i
t0 = Ticks() - t0
PRINT "info SpriteMag total us="; Us(t0)
CHK("cost_SpriteMag_under_400us", STR$(Us(t0) <= 400), "1")
PRINT "DONE"
END
