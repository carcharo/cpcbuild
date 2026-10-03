REM MODELS: 48
REM TIMEOUT: 30
REM ZXBC: -D ZX48 -D BEEPTEST -H 256
REM Starfall Spectrum 48K beeper effects (platform_zx.bas PlatSfx): each of the four
REM returns, leaves the border colour as BORDER set it (bit 4 low at the end, MIC
REM off), keeps interrupts enabled, and is dropped when it is not the first of a step.
REM The headless runner only sees the test port, not port &FE, so the toggling itself
REM isn't observed; the effect's run time is: PlatFrames() (interrupts are off while an
REM effect plays, so it undercounts) must advance at least one frame over many calls.
#include <zxtest.bas>
#include "../../platform_zx.bas"

DIM e, c0 AS UBYTE
DIM f0, f1 AS UINTEGER

PlatInit()
BORDER 2
FOR e = 1 TO 4
  PlatFrameBegin()
  c0 = PzBeepCount()
  PlatSfx(e)
  CHK("played_" + STR$(e), STR$(PzBeepCount() - c0), "1")
  CHK("port_" + STR$(e), STR$(PzBeepLast()), "2")
  f0 = PlatFrames()
  PAUSE 2
  f1 = PlatFrames()
  CHK("ints_on_" + STR$(e), STR$(f1 > f0), "1")
NEXT e

BORDER 5
PlatFrameBegin()
PlatSfx(1)
CHK("border_5", STR$(PzBeepLast()), "5")

REM at most one per step: the second and third are dropped, the next step's plays
PlatFrameBegin()
c0 = PzBeepCount()
PlatSfx(2)
PlatSfx(3)
PlatSfx(4)
CHK("one_per_step", STR$(PzBeepCount() - c0), "1")
PlatFrameBegin()
PlatSfx(3)
CHK("next_step", STR$(PzBeepCount() - c0), "2")
REM out-of-range numbers do nothing
PlatFrameBegin()
c0 = PzBeepCount()
PlatSfx(0)
PlatSfx(5)
CHK("range", STR$(PzBeepCount() - c0), "0")

REM the short effects are short: 200 shots, one a step, take about 0.6 s of beeper
REM time (frames missed with interrupts off are not counted: at most 40 here)
f0 = PlatFrames()
FOR e = 1 TO 200
  PlatFrameBegin()
  PlatSfx(1)
NEXT e
f1 = PlatFrames() - f0
CHK("shoot_short", STR$(f1 <= 40), "1")
TEND()
