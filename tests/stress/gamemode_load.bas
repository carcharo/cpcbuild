REM Interrupt load in game mode (Phase 5b). Companion of sound_load.bas.
REM   python3 tools/cpcrun.py tests/stress/gamemode_load.bas --timeout 300
REM (and --model 464, --emu chips|cap32). Not part of the conformance suite.
REM
REM The reference busy loop (20 x 50000 passes of 28 T = 7 s with no
REM interrupts, nominal 350 frames) is timed with Frames(), since the
REM firmware clock stops in game mode:
REM   normal, no hook      (also timed with the clock: 2100 ticks nominal)
REM   normal, trivial hook
REM   game, no hook
REM   game, trivial hook   (RET only, then one that counts)
REM Load = 1 - 350 / frames.

#include "../conformance/lib/fhlib.bas"

CONST NOMINAL AS ULONG = 350

DIM bF, bT AS ULONG

SUB Report(name AS STRING)
  DIM pm, f AS ULONG
  DIM t AS ULONG
  f = sF - bF
  t = Ticks() - bT
  pm = (f - NOMINAL) * 1000 / f
  PRINT "INFO "; name; " frames="; f; " load="; pm / 10; "."; pm MOD 10; "% (ticks="; t; ")"
END SUB

SUB RefLoop(name AS STRING)
  Snap()
  bF = sF
  bT = Ticks()
  Busy(20)
  Snap()
  Report(name)
END SUB

FrameHookOff()
GameMode(0)
RefLoop("normal, no hook")
FrameHook(@hkN)
RefLoop("normal, hook RET")
FrameHook(@hkC)
RefLoop("normal, hook counting")
FrameHookOff()
GameMode(1)
RefLoop("game, no hook")
FrameHook(@hkN)
RefLoop("game, hook RET")
FrameHook(@hkC)
RefLoop("game, hook counting")
FrameHook(@hkT)
RefLoop("game, hook trashing")
GameMode(0)
PRINT "DONE"
