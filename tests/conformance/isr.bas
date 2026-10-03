REM BARE: skip checks the firmware clock and frame-flyback event (KL_TIME_PLEASE, KL_NEW_FRAME_FLY)
REM Conformance: the interrupt front-end (Phase 4d, zxbasic isr.asm).
REM Compiled code runs with interrupts on; the &0038 vector points to
REM our handler, which hands the firmware its registers. Checks:
REM   - interrupts are enabled in compiled code, and the vector is ours;
REM   - the firmware clock (KL TIME PLEASE) advances during a compute
REM     loop that makes no firmware calls (before Phase 4d it stood still);
REM   - a frame flyback event (KL NEW FRAME FLY) fires once per frame
REM     during that loop;
REM   - an alternate-register-heavy workload (SUBs with parameters, 32-bit,
REM     float and fixed-point arithmetic) gives the same results with
REM     interrupts running as with them off.
REM The minutes-long version is tests/stress/isr_stress.bas.

#include <alloc.bas>
#include "lib/chk.bas"

REM P/V after LD A,I is IFF2 (bit 2 of F). The NMOS Z80 can report 0 if
REM an interrupt arrives during that instruction, so callers try twice.
FUNCTION FASTCALL IntsOn() AS UBYTE
  ASM
  ld a, i
  push af
  pop hl
  ld a, l
  and 4
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

FUNCTION FASTCALL IsrAddr() AS UINTEGER
  ASM
  ld hl, .core.__CPC_ISR
  END ASM
END FUNCTION

REM KL TIME PLEASE (&BD0D): DEHL = the 300 Hz clock.
FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

REM KL NEW FRAME FLY (&BCD7): HL = 9-byte block, B = event class
REM (&81: asynchronous, near address), C = ROM select, DE = routine.
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

REM KL DEL FRAME FLY (&BCDD): HL = the block.
SUB FASTCALL DelFrameFly(blk AS UINTEGER)
  ASM
  call .core.__FW_CALL
  defw $BCDD
  END ASM
END SUB

FUNCTION Mix(a AS ULONG, b AS UINTEGER, c AS UBYTE) AS ULONG
  RETURN (a * 3 + b) bXOR (CAST(ULONG, c) << 5)
END FUNCTION

DIM wAcc AS ULONG
DIM wF AS FLOAT
DIM wX AS FIXED

REM No firmware calls in here (the gate would turn interrupts on).
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

DIM a1, a2 AS ULONG
DIM f1, f2 AS FLOAT
DIM x1, x2 AS FIXED
DIM t0, t1, dt, df AS ULONG
DIM buf, fr0, fr1 AS UINTEGER
DIM ok AS UBYTE

REM --- interrupts on, vector ours ---
ok = IntsOn() bOR IntsOn()
CHK("ints_on", STR$(ok), "4")
CHK("vector_jp", STR$(PEEK $0038), "195")
CHK("vector_isr", STR$(PEEK(UINTEGER, $0039) = IsrAddr()), "1")

REM --- a frame flyback event: block (9 bytes) at buf, counter at
REM buf+10, routine at buf+12: ld hl,(cnt) / inc hl / ld (cnt),hl / ret.
REM The firmware calls it with the lower ROM on, so all of it must be in
REM the central 32K (the heap is, under &9E00).
buf = allocate(32)
CHK("buf_central", STR$(buf >= $4000), "1")
POKE UINTEGER buf + 10, 0
POKE buf + 12, $2A : POKE UINTEGER buf + 13, buf + 10
POKE buf + 15, $23
POKE buf + 16, $22 : POKE UINTEGER buf + 17, buf + 10
POKE buf + 19, $C9
NewFrameFly(buf, buf + 12)

REM --- the same workload with interrupts off, then on ---
DisableInts()
Work(300)
a1 = wAcc : f1 = wF : x1 = wX
EnableInts()

t0 = Ticks()
fr0 = PEEK(UINTEGER, buf + 10)
Work(300)
a2 = wAcc : f2 = wF : x2 = wX
fr1 = PEEK(UINTEGER, buf + 10)
t1 = Ticks()
DelFrameFly(buf)

CHK("work_long", STR$(a2), STR$(a1))
CHK("work_float", STR$(f2), STR$(f1))
CHK("work_fixed", STR$(x2), STR$(x1))

dt = t1 - t0
df = fr1 - fr0
PRINT "INFO ticks="; dt; " frames="; df
CHK("clock_runs", STR$(dt > 150), "1")
REM 6 ticks per frame, within 10 % (plus a frame for the edges)
CHK("frames_match", STR$(df * 6 + dt / 10 + 6 >= dt AND df * 6 <= dt + dt / 10 + 6), "1")

PRINT "DONE"
