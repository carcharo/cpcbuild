REM Shared helpers for the frame hook / game mode tests
REM (tests/conformance/framehook.bas, tests/stress/gamemode_*.bas).
REM
REM Include it first thing in the program: it runs a GOTO over the hook
REM routines (machine code, reached as @label), so they sit at top level.
REM
REM Hooks:   hkC  counts into hcnt
REM          hkD  counts into hcnt2
REM          hkT  counts into hcnt, records IFF2 (two reads) in ifon, then
REM               trashes AF BC DE HL IX IY and the alternate bank
REM          hkN  does nothing but RET
REM Timing:  Ticks()       the firmware 300 Hz clock (KL TIME PLEASE)
REM          Snap()        atomically copies FH_FRAMES -> sF and hcnt -> sH
REM          Busy(k)       k x 50000 passes of 28 T (0.35 s with no interrupts)
REM          PollBusy(k)   about k x 0.43 s polling PPI port B bit 0 and
REM                        counting the VSYNC rising edges in vs (an
REM                        independent count of frames)
REM          DiBusy/EiBusy(n)  n passes of 28 T, with / without DI

#ifndef __CONFORMANCE_FHLIB__
#define __CONFORMANCE_FHLIB__

#include <alloc.bas>
#include <framehook.bas>
#include <cpcbuild.bas>
#include "chk.bas"

DIM hcnt, hcnt2 AS UINTEGER
DIM ifon, vs AS UBYTE
DIM sF AS ULONG
DIM sH AS UINTEGER
REM These are only touched from asm: read them so the compiler keeps them
IF hcnt = 1 AND hcnt2 = 1 AND ifon = 1 AND vs = 1 AND sH = 1 AND sF = 1 THEN
  PRINT "INFO unreachable"
END IF

GOTO fhskip

hkC:
ASM
  ld hl, (_hcnt)
  inc hl
  ld (_hcnt), hl
  ret
END ASM

hkD:
ASM
  ld hl, (_hcnt2)
  inc hl
  ld (_hcnt2), hl
  ret
END ASM

hkN:
ASM
  ret
END ASM

hkT:
ASM
  ld a, i
  jp po, HKT_A
  ld a, 1
  ld (_ifon), a
HKT_A:
  ld a, i
  jp po, HKT_B
  ld a, 1
  ld (_ifon), a
HKT_B:
  ld hl, (_hcnt)
  inc hl
  ld (_hcnt), hl
  ld bc, $DEAD
  ld de, $BEEF
  ld hl, $1234
  exx
  ld bc, $0BAD
  ld de, $F00D
  ld hl, $C0DE
  exx
  scf
  ex af, af'
  ld a, $FF
  scf
  ex af, af'
  ld ix, $1111
  ld iy, $2222
  ld a, $A5
  ret
END ASM

fhskip:

REM KL TIME PLEASE (&BD0D): DEHL = the 300 Hz clock.
FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

REM TXT OUTPUT (&BB5A): one character (not echoed to the printer).
SUB FASTCALL PutCh(c AS UBYTE)
  ASM
  call .core.__FW_CALL
  defw $BB5A
  END ASM
END SUB

REM MC WAIT FLYBACK (&BD19), a firmware call that takes a frame.
SUB FASTCALL WaitFly()
  ASM
  call .core.__FW_CALL
  defw $BD19
  END ASM
END SUB

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

SUB Snap()
  ASM
  di
  ld hl, (.core.FH_FRAMES)
  ld (_sF), hl
  ld hl, (.core.FH_FRAMES + 2)
  ld (_sF + 2), hl
  ld hl, (_hcnt)
  ld (_sH), hl
  ei
  END ASM
END SUB

SUB FASTCALL Busy(k AS UBYTE)
  ASM
  ld d, a
  BZ_OUTER:
  ld bc, 50000
  BZ_INNER:
  dec bc
  ld a, b
  or c
  jp nz, BZ_INNER
  dec d
  jr nz, BZ_OUTER
  END ASM
END SUB

SUB FASTCALL DiBusy(n AS UINTEGER)
  ASM
  ld b, h
  ld c, l
  di
  DB_LOOP:
  dec bc
  ld a, b
  or c
  jp nz, DB_LOOP
  ei
  END ASM
END SUB

SUB FASTCALL EiBusy(n AS UINTEGER)
  ASM
  ld b, h
  ld c, l
  EB_LOOP:
  dec bc
  ld a, b
  or c
  jp nz, EB_LOOP
  END ASM
END SUB

REM vs must stay under 256: k <= 5.
SUB FASTCALL PollBusy(k AS UBYTE)
  ASM
  ld d, a
  ld e, 0
  xor a
  ld (_vs), a
  ld bc, $F500
  PB_OUTER:
  ld hl, 20000
  PB_INNER:
  in a, (c)
  and 1
  cp e
  jr z, PB_NEXT
  ld e, a
  or a
  jr z, PB_NEXT
  ld a, (_vs)
  inc a
  ld (_vs), a
  PB_NEXT:
  dec hl
  ld a, h
  or l
  jp nz, PB_INNER
  dec d
  jr nz, PB_OUTER
  END ASM
END SUB

FUNCTION Mix(a AS ULONG, b AS UINTEGER, c AS UBYTE) AS ULONG
  RETURN (a * 3 + b) bXOR (CAST(ULONG, c) << 5)
END FUNCTION

DIM wAcc AS ULONG
DIM wF AS FLOAT
DIM wX AS FIXED

REM Register-heavy work; no firmware calls.
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

REM The same with a firmware call (character to the screen, clock read)
REM every few passes.
SUB WorkFW(n AS UINTEGER)
  DIM i AS UINTEGER
  DIM t AS ULONG
  wAcc = 777
  wF = 1.25
  wX = 0.5
  FOR i = 1 TO n
    wAcc = Mix(wAcc, i, i bAND 255)
    wF = wF * 0.999 + SIN(wF) / 9
    wX = wX * 0.75 + 0.25
    IF (i bAND 3) = 0 THEN
      PutCh(48 + (i bAND 15))
      t = Ticks()
    END IF
  NEXT i
END SUB

#endif
