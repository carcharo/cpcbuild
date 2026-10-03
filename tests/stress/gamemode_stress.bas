REM Stress test: the frame hook and game mode (Phase 5b).
REM Not part of the conformance suite (it runs for minutes). Run with
REM   python3 tools/cpcrun.py tests/stress/gamemode_stress.bas --timeout 900
REM (and --model 464, --emu chips|cap32). Like isr_stress.bas, but game
REM mode is switched on and off every 2 passes while a hook that trashes
REM every register counts the frames. It loops until MINUTES of frames
REM (50 a second, from Frames(): the firmware clock stops in game mode)
REM have passed. Each pass mixes:
REM   - the register-heavy workload (SUBs with parameters, 32-bit, float,
REM     fixed point), with and without firmware calls, whose results must
REM     equal references made with interrupts off;
REM   - firmware calls (TXT OUTPUT, INKEY$), direct hardware (ScanKeys,
REM     SetPalette, ClearScreen's interrupt-safe chunks);
REM   - frame checks: the hook count equals the Frames() delta; in a
REM     normal-mode pass the frames follow the firmware clock (+-1); every
REM     8th pass a polling loop counts VSYNC edges, which must equal the
REM     frames (+-1) in either mode; the hook never saw interrupts on.
REM Prints "FAIL ..." on any mismatch, then a summary and DONE.

#include "../conformance/lib/fhlib.bas"

CONST MINUTES AS ULONG = 3

DIM pal(3) AS UBYTE => {1, 24, 20, 6}
DIM refA, refB AS ULONG
DIM refF, refG AS FLOAT
DIM refX, refY AS FIXED
DIM bF, dF, startF, total, passes, fails, gmPasses, nPasses, polls AS ULONG
DIM bT, dT AS ULONG
DIM bH, dH AS UINTEGER
DIM gm AS UBYTE
DIM k$ AS STRING
DIM d AS LONG

SUB Fail(msg AS STRING)
  fails = fails + 1
  PRINT "FAIL "; msg; " pass="; passes
END SUB

ScreenInit()
DisableInts()
Work(4)
refA = wAcc : refF = wF : refX = wX
EnableInts()
WorkFW(4)
refB = wAcc : refG = wF : refY = wX

hcnt = 0
ifon = 0
FrameHook(@hkT)
Snap()
startF = sF
gm = 0
DO
  gm = (passes >> 1) bAND 1
  GameMode(gm)
  Snap()
  bF = sF : bH = sH
  bT = Ticks()

  Work(4)
  IF wAcc <> refA OR wF <> refF OR wX <> refX THEN Fail("work")
  WorkFW(4)
  IF wAcc <> refB OR wF <> refG OR wX <> refY THEN Fail("work_fw")
  ScanKeys()
  pal(0) = passes bAND 15
  SetPalette(@pal(0), 4)
  IF (passes bAND 7) = 0 THEN ClearScreen(passes bAND 3)
  PutCh(48 + (passes bAND 31))
  k$ = INKEY$

  dT = Ticks() - bT
  Snap()
  dF = sF - bF
  dH = sH - bH
  IF dH <> (dF bAND $FFFF) THEN Fail("hook_ne_frames")
  IF gm = 0 THEN
    nPasses = nPasses + 1
    d = CAST(LONG, dF) - CAST(LONG, dT) / 6
    IF d < -1 OR d > 1 THEN
      Fail("frames_vs_clock frames=" + STR$(dF) + " ticks=" + STR$(dT))
    END IF
  ELSE
    gmPasses = gmPasses + 1
  END IF
  IF (passes bAND 7) = 3 THEN
    Snap()
    bF = sF
    PollBusy(1)
    Snap()
    d = CAST(LONG, sF - bF) - CAST(LONG, vs)
    polls = polls + 1
    IF d < -1 OR d > 1 THEN
      Fail("frames_vs_vsync frames=" + STR$(sF - bF) + " edges=" + STR$(vs) + " gm=" + STR$(gm))
    END IF
  END IF
  IF ifon <> 0 THEN Fail("hook_saw_interrupts_on")
  passes = passes + 1
  total = sF - startF
LOOP UNTIL total >= MINUTES * 3000
GameMode(0)
FrameHookOff()
Snap()
total = sF - startF

PRINT
PRINT "INFO passes="; passes; " normal="; nPasses; " game="; gmPasses; " vsync checks="; polls; " frames="; total; " hook="; sH
CHK("no_fails", STR$(fails), "0")
DIM okh AS UBYTE
okh = (sH = (total bAND $FFFF))
CHK("hook_total", STR$(okh), "1")
PRINT "DONE"
