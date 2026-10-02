REM Stress test: the interrupt front-end (Phase 4d, zxbasic isr.asm).
REM Not part of the conformance suite (it runs for minutes). Run with
REM   python3 tools/cpcrun.py tests/stress/isr_stress.bas --timeout 900
REM (and --model 464). Loops until MINUTES of the firmware's clock have
REM passed, each pass mixing everything that touches interrupts:
REM   - an alternate-register-heavy workload (SUBs with parameters, 32-bit,
REM     float, fixed point) whose results must equal a reference made
REM     with interrupts off;
REM   - firmware calls (TXT OUTPUT to the screen, INKEY$);
REM   - direct hardware: ScanKeys (PPI), SetPalette (Gate Array),
REM     ClearScreen (PUSH fill in interrupt-safe chunks);
REM   - a frame flyback event counting frames, which must match the clock.
REM Prints "FAIL ..." on any mismatch, then a summary and DONE.

#include <alloc.bas>
#include <cpcbuild.bas>
#include "../conformance/lib/chk.bas"

CONST MINUTES AS ULONG = 3

FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

SUB FASTCALL DisableInts()
  ASM
  di
  END ASM
END SUB

SUB FASTCALL EnableInts()
  ASM
  ei
  END ASM
END SUB

SUB NewFrameFly(blk AS UINTEGER, rtn AS UINTEGER)
  ASM
  ld l, (ix+4)
  ld h, (ix+5)
  ld e, (ix+6)
  ld d, (ix+7)
  ld bc, $8100
  call .core.__FW_CALL
  defw $BCD7
  END ASM
END SUB

SUB FASTCALL DelFrameFly(blk AS UINTEGER)
  ASM
  call .core.__FW_CALL
  defw $BCDD
  END ASM
END SUB

REM TXT OUTPUT (&BB5A): one character to the screen (not echoed to the
REM printer, unlike PRINT in test builds).
SUB FASTCALL PutCh(c AS UBYTE)
  ASM
  call .core.__FW_CALL
  defw $BB5A
  END ASM
END SUB

FUNCTION Mix(a AS ULONG, b AS UINTEGER, c AS UBYTE) AS ULONG
  RETURN (a * 3 + b) bXOR (CAST(ULONG, c) << 5)
END FUNCTION

DIM wAcc AS ULONG
DIM wF AS FLOAT
DIM wX AS FIXED

SUB Work(n AS UINTEGER)
  DIM i AS UINTEGER
  wAcc = 12345
  wF = 1.5
  wX = 0.25
  FOR i = 1 TO n
    wAcc = Mix(wAcc, i, i bAND 255)
    wF = wF * 0.999 + SIN(wF) / 7
    wX = wX * 0.75 + 0.5
  NEXT i
END SUB

DIM pal(3) AS UBYTE => {1, 24, 20, 6}
DIM refA AS ULONG
DIM refF AS FLOAT
DIM refX AS FIXED
DIM t0, t, f0, frames, passes, fails AS ULONG
DIM buf AS UINTEGER
DIM k$ AS STRING

ScreenInit()
DisableInts()
Work(20)
refA = wAcc : refF = wF : refX = wX
EnableInts()

buf = allocate(32)
POKE UINTEGER buf + 10, 0
POKE buf + 12, $2A : POKE UINTEGER buf + 13, buf + 10
POKE buf + 15, $23
POKE buf + 16, $22 : POKE UINTEGER buf + 17, buf + 10
POKE buf + 19, $C9
NewFrameFly(buf, buf + 12)

t0 = Ticks()
f0 = PEEK(UINTEGER, buf + 10)
DO
  Work(20)
  IF wAcc <> refA OR wF <> refF OR wX <> refX THEN
    fails = fails + 1
    PRINT "FAIL work pass="; passes
  END IF
  ScanKeys()
  pal(0) = passes bAND 15
  SetPalette(@pal(0), 4)
  IF (passes bAND 7) = 0 THEN ClearScreen(passes bAND 3)
  PutCh(48 + (passes bAND 31))
  k$ = INKEY$
  passes = passes + 1
  t = Ticks() - t0
  REM the frame counter is 16-bit: fold the frame check in every pass
  frames = PEEK(UINTEGER, buf + 10) - f0
LOOP UNTIL t >= MINUTES * 60 * 300
DelFrameFly(buf)

PRINT
PRINT "INFO passes="; passes; " ticks="; t; " frames="; frames
CHK("no_work_fails", STR$(fails), "0")
CHK("frames_match", STR$(frames * 6 + t / 100 + 12 >= t AND frames * 6 <= t + t / 100 + 12), "1")
PRINT "DONE"
