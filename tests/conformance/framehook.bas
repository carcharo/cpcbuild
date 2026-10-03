REM BARE: skip uses the firmware clock (KL_TIME_PLEASE), GameMode and firmware calls; bareframes.bas is the bare counterpart
REM Conformance: the frame hook and game mode (Phase 5b, zxbasic
REM framehook.bas / runtime/framehook.asm / isr.asm).
REM
REM Normal mode: Frames() follows the firmware clock (6 ticks a frame) and
REM the VSYNC edges; the hook runs once a frame (equal to the Frames()
REM delta) during compute, WaitRetrace, PRINT and INKEY$ loops; it runs
REM with interrupts off and may trash every register; FrameHookOff and
REM re-pointing work.
REM Game mode: the same counts; the firmware clock stands still outside
REM firmware calls and runs in them; GameMode(0) restores it; switching
REM many times loses and doubles no frame; DI sections of 2000-8000 T
REM (the 6th-interrupt fallback) lose and double none.
REM
REM Not tested: the Gate Array palette surviving the firmware's ink
REM refresh in game mode (the GA can't be read back).

#include "lib/fhlib.bas"

DIM bF, dF AS ULONG
DIM bH, dH AS UINTEGER
DIM bT, eT, dT AS ULONG
DIM a1, a2, b1, b2 AS ULONG
DIM f1, f2, g1, g2 AS FLOAT
DIM x1, x2, y1, y2 AS FIXED
DIM i, j AS UINTEGER
DIM refN, refG, runF, inkN AS LONG
DIM k$ AS STRING

SUB Begin()
  Snap()
  bF = sF
  bH = sH
  bT = Ticks()
END SUB

SUB Finish()
  eT = Ticks()
  Snap()
  dF = sF - bF
  dH = sH - bH
  dT = eT - bT
END SUB

REM PASS if lo <= v <= hi
SUB Rng(name AS STRING, v AS LONG, lo AS LONG, hi AS LONG)
  IF v >= lo AND v <= hi THEN
    PRINT "PASS "; name
  ELSE
    PRINT "FAIL "; name; " got="; v; " want="; lo; ".."; hi
  END IF
END SUB

REM The hook count equals the Frames() delta; the frame count is
REM plausible; the clock (if running) agrees.
SUB HookEqFrames(name AS STRING)
  CHK(name + "_hook_eq_frames", STR$(dH), STR$(dF bAND $FFFF))
END SUB

ScreenInit()

REM --- references: the work with the hook off, interrupts off ---
DisableInts()
Work(300)
a1 = wAcc : f1 = wF : x1 = wX
EnableInts()
WorkFW(100)
b1 = wAcc : g1 = wF : y1 = wX

REM ================= normal mode =================
PRINT "INFO normal mode"
hcnt = 0
FrameHook(@hkC)

REM compute loop
Begin()
Busy(4)
Finish()
PRINT "INFO compute: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("n_compute")
Rng("n_compute_frames", CAST(LONG, dF), 60, 200)
Rng("n_compute_vs_ticks", CAST(LONG, dF) - CAST(LONG, dT) / 6, -1, 1)
Snap() : bF = sF
PollBusy(2)
Snap()
dF = sF - bF
PRINT "INFO poll: frames="; dF; " vsync edges="; vs
Rng("n_compute_vs_edges", CAST(LONG, dF) - CAST(LONG, vs), -1, 1)

REM WaitRetrace(1) x 20 and WaitRetrace(3) x 10
Begin()
FOR i = 1 TO 20
  WaitRetrace(1)
NEXT i
Finish()
PRINT "INFO wait1 x20: frames="; dF; " hook="; dH
HookEqFrames("n_wait1")
Rng("n_wait1_frames", CAST(LONG, dF), 20, 20)
Begin()
FOR i = 1 TO 10
  WaitRetrace(3)
NEXT i
Finish()
PRINT "INFO wait3 x10: frames="; dF; " hook="; dH
HookEqFrames("n_wait3")
Rng("n_wait3_frames", CAST(LONG, dF), 30, 30)

REM INKEY$ polling (no key is pressed)
Begin()
FOR i = 1 TO 30000
  k$ = INKEY$
NEXT i
Finish()
PRINT "INFO inkey: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("n_inkey")
inkN = dF
Rng("n_inkey_ran", CAST(LONG, dF), 10, 10000)
Rng("n_inkey_vs_ticks", CAST(LONG, dF) - CAST(LONG, dT) / 6, -1, 1)

REM PRINT loop (the printer echo makes it slow)
Begin()
FOR i = 1 TO 12
  PRINT "INFO print line "; i
NEXT i
Finish()
PRINT "INFO print: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("n_print")
Rng("n_print_vs_ticks", CAST(LONG, dF) - CAST(LONG, dT) / 6, -1, 1)

REM --- the hook runs with interrupts off and trashes everything ---
hcnt = 0
ifon = 0
FrameHook(@hkT)
Begin()
Work(300)
a2 = wAcc : f2 = wF : x2 = wX
Finish()
HookEqFrames("n_trash_work")
Rng("n_trash_hook_ran", CAST(LONG, dH), 10, 1000)
CHK("n_trash_long", STR$(a2), STR$(a1))
CHK("n_trash_float", STR$(f2), STR$(f1))
CHK("n_trash_fixed", STR$(x2), STR$(x1))
Begin()
WorkFW(100)
b2 = wAcc : g2 = wF : y2 = wX
Finish()
HookEqFrames("n_trash_fw")
CHK("n_trash_fw_long", STR$(b2), STR$(b1))
CHK("n_trash_fw_float", STR$(g2), STR$(g1))
CHK("n_trash_fw_fixed", STR$(y2), STR$(y1))
CHK("n_hook_ints_off", STR$(ifon), "0")

REM --- FrameHookOff, and re-pointing ---
hcnt = 0
hcnt2 = 0
FrameHook(@hkC)
Busy(1)
Snap() : bH = sH : bF = sF
FrameHookOff()
Busy(1)
Snap()
CHK("n_off_hook_stopped", STR$(sH), STR$(bH))
Rng("n_off_frames_go_on", CAST(LONG, sF - bF), 10, 100)
FrameHook(@hkC)
Busy(1)
Snap()
Rng("n_on_again", CAST(LONG, sH - bH), 10, 100)
hcnt2 = 0
Snap() : bH = sH : bF = sF
FrameHook(@hkD)
Busy(1)
FrameHookOff()
Snap()
CHK("n_switch_old_stopped", STR$(sH), STR$(bH))
Rng("n_switch_new_runs", CAST(LONG, hcnt2), 10, 100)
CHK("n_switch_new_eq_frames", STR$(hcnt2), STR$((sF - bF) bAND $FFFF))
FrameHookOff()

REM ================= game mode =================
PRINT "INFO game mode"
hcnt = 0
FrameHook(@hkC)
GameMode(1)

REM compute: the clock stands still, frames are counted
Begin()
Busy(4)
Finish()
GameMode(0)
PRINT "INFO g compute: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("g_compute")
Rng("g_compute_frames", CAST(LONG, dF), 60, 200)
Rng("g_compute_clock_stopped", CAST(LONG, dT), 0, 2)
GameMode(1)
Snap() : bF = sF
PollBusy(2)
Snap()
dF = sF - bF
PRINT "INFO g poll: frames="; dF; " vsync edges="; vs
Rng("g_compute_vs_edges", CAST(LONG, dF) - CAST(LONG, vs), -1, 1)

REM the clock runs during firmware calls (10 x MC WAIT FLYBACK)
Begin()
FOR i = 1 TO 10
  WaitFly()
NEXT i
Finish()
PRINT "INFO g waitfly x10: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("g_waitfly")
Rng("g_waitfly_clock_runs", CAST(LONG, dT), 48, 66)
Rng("g_waitfly_frames", CAST(LONG, dF), 9, 11)

REM WaitRetrace loops
Begin()
FOR i = 1 TO 20
  WaitRetrace(1)
NEXT i
Finish()
PRINT "INFO g wait1 x20: frames="; dF; " hook="; dH
HookEqFrames("g_wait1")
Rng("g_wait1_frames", CAST(LONG, dF), 20, 20)
Begin()
FOR i = 1 TO 10
  WaitRetrace(3)
NEXT i
Finish()
PRINT "INFO g wait3 x10: frames="; dF; " hook="; dH
HookEqFrames("g_wait3")
Rng("g_wait3_frames", CAST(LONG, dF), 30, 30)

REM PRINT loop (firmware calls with compute between): frames follow the
REM clock, which runs inside the calls only; compare with the same loop
REM in normal mode.
GameMode(0)
Begin()
FOR i = 1 TO 12
  PRINT "INFO print line "; i
NEXT i
Finish()
refN = dF
GameMode(1)
Begin()
FOR i = 1 TO 12
  PRINT "INFO print line "; i
NEXT i
Finish()
PRINT "INFO g print: frames="; dF; " hook="; dH; " ticks="; dT; " normal="; refN
HookEqFrames("g_print")
Rng("g_print_frames_vs_normal", CAST(LONG, dF) - refN, -3, 3)

REM INKEY$ polling (all firmware calls)
Begin()
FOR i = 1 TO 30000
  k$ = INKEY$
NEXT i
Finish()
PRINT "INFO g inkey: frames="; dF; " hook="; dH; " ticks="; dT
HookEqFrames("g_inkey")
Rng("g_inkey_ran", CAST(LONG, dF), 10, 10000)
REM mostly compute between the calls: no slower than normal mode, and
REM not more than about 25 % faster (the firmware handler's load is 12-23 %)
Rng("g_inkey_vs_normal", CAST(LONG, dF) - inkN, -inkN / 4 - 2, 2)

REM register preservation in game mode
FrameHook(@hkT)
ifon = 0
hcnt = 0
Begin()
Work(300)
a2 = wAcc : f2 = wF : x2 = wX
Finish()
HookEqFrames("g_trash_work")
Rng("g_trash_hook_ran", CAST(LONG, dH), 10, 1000)
CHK("g_trash_long", STR$(a2), STR$(a1))
CHK("g_trash_float", STR$(f2), STR$(f1))
CHK("g_trash_fixed", STR$(x2), STR$(x1))
Begin()
WorkFW(100)
b2 = wAcc : g2 = wF : y2 = wX
Finish()
HookEqFrames("g_trash_fw")
CHK("g_trash_fw_long", STR$(b2), STR$(b1))
CHK("g_trash_fw_float", STR$(g2), STR$(g1))
CHK("g_trash_fw_fixed", STR$(y2), STR$(y1))
CHK("g_hook_ints_off", STR$(ifon), "0")
FrameHook(@hkC)

REM GameMode(0): the clock runs again in compute
GameMode(0)
Begin()
Busy(2)
Finish()
PRINT "INFO back to normal: frames="; dF; " ticks="; dT
HookEqFrames("back_normal")
Rng("back_normal_clock_runs", CAST(LONG, dT), 60, 1000)
Rng("back_normal_vs_ticks", CAST(LONG, dF) - CAST(LONG, dT) / 6, -1, 1)

REM --- many switches: no frame lost or doubled ---
GameMode(0)
Begin()
FOR i = 1 TO 20
  Busy(1)
NEXT i
Finish()
refN = dF
GameMode(1)
Begin()
FOR i = 1 TO 20
  Busy(1)
NEXT i
Finish()
refG = dF
GameMode(0)
Begin()
FOR i = 1 TO 20
  GameMode(1)
  Busy(1)
  GameMode(0)
  Busy(1)
NEXT i
Finish()
runF = dF
PRINT "INFO switches: ref normal="; refN; " ref game="; refG; " run="; runF; " hook="; dH
HookEqFrames("sw")
Rng("sw_total", runF - (refN + refG), -4, 4)

REM --- DI sections of dp x 28 T: the hook still runs once a frame ---
REM Each run does the same loop with the section DI (frames counted by
REM Frames(), time kept by the CPU) and with it EI (reference).
GameMode(1)
DIM dp, m AS UINTEGER
DIM dpv(4) AS UINTEGER => {70, 100, 143, 200, 300}
FOR j = 0 TO 4
  dp = dpv(j)
  m = 60000 / (dp + 30)
  Begin()
  FOR i = 1 TO 7 * m
    EiBusy(dp)
    EiBusy(20)
  NEXT i
  Finish()
  refN = dF
  Begin()
  FOR i = 1 TO 7 * m
    DiBusy(dp)
    EiBusy(20)
  NEXT i
  Finish()
  PRINT "INFO di "; dp * 28; " T: ref frames="; refN; " di frames="; dF; " hook="; dH
  HookEqFrames("di" + STR$(dp * 28))
  Rng("di" + STR$(dp * 28) + "_vs_ref", CAST(LONG, dF) - refN, -3, 3)
NEXT j
GameMode(0)

PRINT "DONE"
