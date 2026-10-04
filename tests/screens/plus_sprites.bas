REM Screen test (CPC Plus, Phase 7 P2): hardware sprites over a 12-bit palette. Mode 1
REM with four 12-bit pens (none is one of the CPC's 27 colours), a 12-bit border, and the
REM two-frame sprite sheet tests/conformance/assets/plus_ball.png (img2cpc.py
REM --plus-sprite) shown at all magnifications: disc 1x1, 2x2, 4x4, 4x1, 1x4, diamond 2x2,
REM 2x4, 4x2, two 4x4 overlapping (the lower sprite number is on top), one sprite hidden,
REM the sprite colour 1 (the outline) recoloured. A wait of 60 frames before the shot, so
REM a firmware ink refresh (every 10 frames in firmware mode; SetPalette12 takes the
REM firmware's ticker out) would have overwritten the palette by then.
REM On a CPC without ASIC (chips 464/6128 goldens) every Plus call does nothing and the
REM program writes NO PLUS: the library is safe to call everywhere.
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/fill.bas>
#include <cpcplus/cpcplus.bas>
#include "../conformance/assets/plus_ball.bas"
#include "lib/shot.bas"

Mode 1
ScreenInit()
CLS
REM bars of the four pens
FillRect(0, 0, 80, 100, 0)
FillRect(0, 100, 40, 100, 2)
FillRect(40, 100, 40, 100, 3)
FillRect(20, 40, 40, 20, 1)
SetPalette12(0, $0126)
SetPalette12(1, $0FE8)
SetPalette12(2, $0A3C)
SetPalette12(3, $04D6)
SetBorder12($0F61)
PRINT AT 0, 1; "CPC PLUS SPRITES"
IF PlusAvailable() = 0 THEN
  PRINT AT 24, 1; "NO PLUS"
END IF

SpritePalette(@plusball_pal(0))
SpriteColour(1, $0F0F)
DIM n AS UBYTE
FOR n = 0 TO 3
  SpriteSetImage(n, @plusball(0))
NEXT n
FOR n = 4 TO 15
  SpriteSetImage(n, @plusball(256))
NEXT n
SpriteSetImage(9, @plusball(0))
REM row 1: disc (frame 0) at y = 8
SpriteMove(0, 24, 8): SpriteMag(0, 1, 1)
SpriteMove(1, 80, 8): SpriteMag(1, 2, 2)
SpriteMove(2, 160, 8): SpriteMag(2, 4, 4)
SpriteMove(3, 280, 8): SpriteMag(3, 4, 1)
SpriteMove(4, 380, 8): SpriteMag(4, 1, 4)
REM row 2: diamond (frame 1) at y = 110
SpriteMove(5, 24, 110): SpriteMag(5, 2, 2)
SpriteMove(6, 80, 110): SpriteMag(6, 2, 4)
SpriteMove(7, 160, 110): SpriteMag(7, 4, 2)
REM overlap: 8 (diamond) must be over 9 (disc)
SpriteMove(9, 300, 110): SpriteMag(9, 4, 4)
SpriteMove(8, 330, 125): SpriteMag(8, 4, 4)
REM hidden after being shown
SpriteMove(10, 500, 110): SpriteMag(10, 4, 4)
SpriteHide(10)
REM Y shows a sprite is on the top lines of the picture too
SpriteMove(11, 600, 0): SpriteMag(11, 1, 1)
WaitRetrace(60)
Shot("plus_sprites")
