REM Screen test (CPC Plus): palette cycling (lib/cpcplus/palcycle.bas). Mode 0 with 15 bars
REM (pens 1-15) and four hardware sprites of the plus_ball disc, magnified 4x4. Cycle 0 rotates
REM pens 1-8 (a forward ramp, period 1), cycle 1 sweeps pens 9-15 back and forth (ping-pong,
REM period 2), cycle 2 rotates the sprite colours 1-4 backward (period 3) and sprite colours 5-15
REM stay as the sprite palette set them. Exactly 30 frames of PalCycleStep, then the shot: the
REM bars show a rotation of 30 moves mod 8 = 6 for cycle 0, offset 3 for the ping-pong after its
REM 15 moves (0 up to 6, down to 0, up to 3), and a backward rotation of 10 moves mod 4 = 2 for
REM the sprites. (The paper of mode 0 shows pen 5's colour in these Plus goldens, as in
REM plus_palette12.) Without an ASIC every Plus
REM call does nothing and the program writes NO PLUS.
#include <cpc.bas>
#include <cpcbuild/display.bas>
#include <cpcbuild/fill.bas>
#include <cpcplus/palcycle.bas>
#include "../conformance/assets/plus_ball.bas"
#include "lib/shot.bas"

DIM ramp(7) AS UINTEGER => {$0F00, $0F80, $0FF0, $08F0, $00F0, $00F8, $00FF, $008F}
DIM sweep(6) AS UINTEGER => {$0FFF, $0CCC, $0999, $0666, $0333, $0111, $0000}
DIM spr(3) AS UINTEGER => {$0F0F, $0FF0, $00FF, $0F00}
DIM p, i AS UBYTE

Mode 0
ScreenInit()
CLS
FOR p = 1 TO 15
  FillRect((p - 1) * 5, 20, 5, 100, p)
NEXT p
SetInk(0, 0)
SetPalette12(0, $0000)
SetBorder12($0222)
PRINT AT 0, 1; "PALETTE CYCLING"
IF PlusAvailable() = 0 THEN
  PRINT AT 24, 1; "NO PLUS"
END IF

SpritePalette(@plusball_pal(0))
FOR i = 0 TO 3
  SpriteSetImage(i, @plusball(0))
  SpriteMove(i, 40 + i * 150, 140)
  SpriteMag(i, 4, 4)
NEXT i

PalCycleSet(0, 0, 1, 8, @ramp(0), 1)
PalCycleSet(1, 0, 9, 7, @sweep(0), 2)
PalCycleDir(1, 2)
PalCycleSet(2, 1, 1, 4, @spr(0), 3)
PalCycleDir(2, 1)
FOR i = 1 TO 30
  WaitRetrace(1)
  PalCycleStep()
NEXT i
WaitRetrace(10)
Shot("plus_palcycle")
