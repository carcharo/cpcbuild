REM MODELS: plus
REM Conformance: the cost of the cpcplus calls (Phase 7 speed fixes, Caprice32 only).
REM Each call is made N times in a BASIC loop and timed with Ticks() (300 Hz
REM firmware, 50 Hz * 6 bare: so N is large). The loop's own cost, with a call of
REM an empty SUB of the same signature, is measured the same way, so "net" is
REM what the library routine adds to any BASIC call. Bounds are in microseconds
REM per call (the CPC's 4 MHz with its wait states: Caprice32 emulates them) and
REM are about 1.4 times the measured values (see the header of cpcplus.bas for them and for
REM the costs before the fast paths, which were 2-3 times these bounds). Pictures and blocks
REM (SpriteSetImage, SpriteSetImagePacked, PlusPokeBlock; source outside and inside &4000-&7FFF)
REM are milliseconds a call, timed over fewer calls; RasterIntMove is bare only.

#include <cpc.bas>
#include <cpcbuild/display.bas>
#include "lib/chk.bas"
#include "lib/plushelp.bas"
#include "lib/ticks.bas"
#ifdef CPC_BAREMETAL
#include <framehook.bas>
#endif

CONST N AS UINTEGER = 1500

DIM blk(63) AS UBYTE
DIM tbl(63) AS UBYTE
DIM img(255) AS UBYTE
CONST M AS UINTEGER = 200
CONST INWIN AS UINTEGER = $6000         REM RAM inside &4000-&7FFF (bounced through the library's buffer)
DIM i AS UINTEGER
DIM t0, base3, base2, base2f AS ULONG
DIM okc AS UINTEGER

SUB Nop2(a AS UBYTE, b AS UINTEGER)
END SUB

SUB Nop3(a AS UBYTE, b AS INTEGER, c AS INTEGER)
END SUB

#ifdef CPC_BAREMETAL
FUNCTION FASTCALL HandlerAddr() AS UINTEGER
  ASM
  ld hl, SP_HANDLER
  jp SP_SKIP
SP_HANDLER:
  ret
SP_SKIP:
  END ASM
END FUNCTION

FUNCTION Nop2f(a AS UBYTE, b AS UBYTE) AS UBYTE
  RETURN 1
END FUNCTION
#endif

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

REM Pictures and blocks (fewer calls: each is milliseconds). Source outside and inside
REM the &4000-&7FFF window, which the library treats differently.
REM Us2: microseconds per call over M calls (the loop is negligible next to a picture).
FUNCTION Us2(t AS ULONG) AS ULONG
  RETURN (t * 3333) / M
END FUNCTION

t0 = Ticks()
FOR i = 1 TO M
  SpriteSetImage(3, @img(0))
NEXT i
t0 = Ticks() - t0
PRINT "info SpriteSetImage total us="; Us2(t0)
CHK("cost_SpriteSetImage_under_2800us", STR$(Us2(t0) <= 2800), "1")
t0 = Ticks()
FOR i = 1 TO M
  SpriteSetImage(3, INWIN)
NEXT i
t0 = Ticks() - t0
PRINT "info SpriteSetImage_inwin total us="; Us2(t0)
CHK("cost_SpriteSetImage_inwin_under_5500us", STR$(Us2(t0) <= 5500), "1")
t0 = Ticks()
FOR i = 1 TO M
  SpriteSetImagePacked(3, @img(0))
NEXT i
t0 = Ticks() - t0
PRINT "info SpriteSetImagePacked total us="; Us2(t0)
CHK("cost_SpriteSetImagePacked_under_7300us", STR$(Us2(t0) <= 7300), "1")
t0 = Ticks()
FOR i = 1 TO M
  SpriteSetImagePacked(3, INWIN)
NEXT i
t0 = Ticks() - t0
PRINT "info SpriteSetImagePacked_inwin total us="; Us2(t0)
CHK("cost_SpriteSetImagePacked_inwin_under_7300us", STR$(Us2(t0) <= 7300), "1")
t0 = Ticks()
FOR i = 1 TO M
  PlusPokeBlock($6000, @img(0), 88)
NEXT i
t0 = Ticks() - t0
PRINT "info PlusPokeBlock88 total us="; Us2(t0)
CHK("cost_PlusPokeBlock88_under_1300us", STR$(Us2(t0) <= 1300), "1")
t0 = Ticks()
FOR i = 1 TO M
  PlusPokeBlock($4000, @img(0), 256)
NEXT i
t0 = Ticks() - t0
PRINT "info PlusPokeBlock256 total us="; Us2(t0)
CHK("cost_PlusPokeBlock256_under_2900us", STR$(Us2(t0) <= 2900), "1")
t0 = Ticks()
FOR i = 1 TO M
  PlusPokeBlock($4000, INWIN, 256)
NEXT i
t0 = Ticks() - t0
PRINT "info PlusPokeBlock256_inwin total us="; Us2(t0)
CHK("cost_PlusPokeBlock256_inwin_under_5500us", STR$(Us2(t0) <= 5500), "1")

#ifdef CPC_BAREMETAL
REM RasterIntMove (bare only): a line moved in place (its neighbours stay on either side),
REM moved across another line (80 <-> 58, across 64; moving the entry that fires next to a line
REM the scan has passed would stall the frame's interrupts, so these never do), and the
REM RasterIntAt + RasterIntOff pair it replaces.
t0 = Ticks()
FOR i = 1 TO N
  Nop2f(40, 41)
  Nop2f(41, 40)
NEXT i
t0 = Ticks() - t0
base2f = t0
RasterIntAt(40, HandlerAddr())
RasterIntAt(52, HandlerAddr())
RasterIntAt(64, HandlerAddr())
RasterIntAt(80, HandlerAddr())
okc = 0
t0 = Ticks()
FOR i = 1 TO N
  okc = okc + RasterIntMove(40, 41)
  okc = okc + RasterIntMove(41, 40)
NEXT i
t0 = Ticks() - t0
PRINT "info RasterIntMove_inplace total us="; (t0 * 3333) / (2 * N); " net="; (t0 * 3333) / (2 * N) - (base2f * 3333) / (2 * N)
CHK("RasterIntMove_inplace_all_moved", STR$(okc), STR$(2 * N))
CHK("cost_RasterIntMove_inplace_under_450us", STR$((t0 * 3333) / (2 * N) <= 450), "1")
okc = 0
t0 = Ticks()
FOR i = 1 TO N
  okc = okc + RasterIntMove(80, 58)
  okc = okc + RasterIntMove(58, 80)
NEXT i
t0 = Ticks() - t0
PRINT "info RasterIntMove_across total us="; (t0 * 3333) / (2 * N)
CHK("RasterIntMove_across_all_moved", STR$(okc), STR$(2 * N))
CHK("cost_RasterIntMove_across_under_800us", STR$((t0 * 3333) / (2 * N) <= 800), "1")
t0 = Ticks()
FOR i = 1 TO N
  RasterIntAt(45, HandlerAddr())
  RasterIntOff(45)
NEXT i
t0 = Ticks() - t0
PRINT "info RasterIntAt_Off_pair total us="; (t0 * 3333) / N
RasterIntClear()
#endif
PRINT "DONE"
END
