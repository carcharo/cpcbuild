REM Starfall Spectrum: per-step cost of the real game loop (attract mode, fixed seed,
REM in-game music on 128K): how many of 250 steps took 2, 3 or more frames (a step is
REM paced to 2; more means the step was too slow), and the total. A profiling aid;
REM it passes if it ran. (main.bas's BENCH gives the headline figure.)
#include <zxtest.bas>
#include "../../platform_zx.bas"
#include "../../game.bas"

DIM n AS UINTEGER
DIM d AS UBYTE
DIM h(7) AS UINTEGER
DIM t0, tt AS UINTEGER
DIM st, inp AS UBYTE

PlatInit()
GameInit()
GameSeed(12345)
PlatClear()
PlatMusic(2)
tt = PlatFrames()
FOR n = 1 TO 250
  t0 = PlatFrames()
  PlatFrameBegin()
  inp = AttractInput()
  st = GameStep(inp)
  GameDraw()
  PlatHud(gScore, gLives, gWave, gHi)
  PlatFrameEnd()
  d = CAST(UBYTE, PlatFrames() - t0)
  IF d > 7 THEN d = 7
  h(d) = h(d) + 1
NEXT n
tt = PlatFrames() - tt
PlatMusic(0)
TLN("PROFILE frames=" + STR$(tt) + " steps with 2:" + STR$(h(2)) + " 3:" + STR$(h(3)) + " 4:" + STR$(h(4)) + " 5+:" + STR$(h(5) + h(6) + h(7)) + " other:" + STR$(h(0) + h(1)))
CHK("ran", STR$(tt > 400), "1")
TEND()
