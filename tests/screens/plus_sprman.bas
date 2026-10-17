REM Screen test (CPC Plus): the sprite slot manager (lib/cpcplus/sprman.bas). Mode 1 with four
REM 12-bit pens, the sprite sheet tests/conformance/assets/plus_ball.png (unpacked and packed).
REM The manager owns slots 2-7; slot 0 is the program's own (SpriteSetImage). Steps: four
REM allocations (disc, disc, diamond, packed disc) and one flush of 2 uploads (two sprites
REM wait), the rest flushed with positions set while they waited, a free and a re-allocation of
REM the same image (a cache hit: no upload), the same address as a packed picture (a miss), then
REM the pool filled up (SprAlloc returns 255). The screen prints the counts and the final
REM picture shows 6 managed sprites plus slot 0, each at its own magnification.
REM Waits 60 frames before the shot (see plus_sprites.bas). Without an ASIC every Plus call does
REM nothing and the program writes NO PLUS.
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/fill.bas>
#include <cpcplus/sprman.bas>
#include "../conformance/assets/plus_ball.bas"
#include "../conformance/assets/plus_ballpk.bas"
#include "lib/shot.bas"

DIM a, b, c, d, e, f, g AS UBYTE
DIM up1, up2, up3, up4 AS UINTEGER

Mode 1
ScreenInit()
CLS
FillRect(0, 0, 80, 100, 0)
FillRect(0, 100, 40, 100, 2)
FillRect(40, 100, 40, 100, 3)
SetPalette12(0, $0126)
SetPalette12(1, $0FE8)
SetPalette12(2, $0A3C)
SetPalette12(3, $04D6)
SetBorder12($0F61)
PRINT AT 0, 1; "SPRITE MANAGER"
IF PlusAvailable() = 0 THEN
  PRINT AT 24, 1; "NO PLUS"
END IF
SpritePalette(@plusball_pal(0))

REM the program's own sprite, outside the manager's slots
SpriteSetImage(0, @plusball(0))
SpriteMove(0, 600, 8): SpriteMag(0, 1, 1)

SprMgrInit(2, 6)
a = SprAlloc(@plusball(0))
b = SprAlloc(@plusball(0))
c = SprAlloc(@plusball(256))
d = SprAllocPacked(@plusballpk(0))
SprMove(a, 24, 56)
SprMove(c, 160, 56): SprMag(c, 2, 2)
SprFlush(2)
up1 = SprUploads()
REM two sprites are still waiting: they are placed before their upload
SprMove(b, 80, 56): SprMag(b, 4, 4)
SprMove(d, 300, 56): SprMag(d, 2, 2)
SprFlush(9)
up2 = SprUploads()

REM free a, ask for the same disc again: it gets slot a back with no upload
SprFree(a)
e = SprAlloc(@plusball(0))
up3 = SprUploads()
SprMove(e, 24, 130): SprMag(e, 2, 4)
REM the packed picture at the same address is not the unpacked one: a miss
f = SprAllocPacked(@plusballpk(0))
SprMove(f, 160, 130): SprMag(f, 4, 2)
SprFlush(9)
up4 = SprUploads()
REM the pool: slots 2-7 -> a(e) b c d f in use, one left; then none
g = SprAlloc(@plusball(256))
SprMove(g, 300, 130)
SprFlush(9)

PRINT AT 2, 1; "UP "; up1; " "; up2; " "; up3; " "; up4; " "; SprUploads()
PRINT AT 3, 1; "SLOTS "; a; " "; b; " "; c; " "; d; " "; e; " "; f; " "; g
PRINT AT 4, 1; "FULL "; SprAlloc(@plusball(0)); " PEND "; SprPending()
WaitRetrace(60)
Shot("plus_sprman")
