REM BARE: only
REM Conformance (bare-metal mode only, -D CPC_BAREMETAL): the frame counter
REM and the frame hook with no firmware clock. Uses only lib/bareout.bas for
REM output (no PRINT) and framehook.bas (FrameHook, FrameHookOff, Frames).
REM
REM Checks, from a disc/quickload start and a cold start alike:
REM   - Frames() is near zero when the program starts (the boot clears the
REM     screen with interrupts on: a few frames);
REM   - Frames() advances 50 a second, measured against a calibrated busy
REM     loop (Busy(k) = k x 50000 passes of 28 T = k x 0.35 s = k x 17.5 frames
REM     with no interrupts; the bare handler costs a few per cent) and against
REM     an independent count of the VSYNC edges (PPI port B bit 0);
REM   - the frame hook runs exactly once per frame (its count = the Frames()
REM     delta), with interrupts off, and may trash every register;
REM   - FrameHookOff stops it, re-pointing works;
REM   - DI sections of up to ~8000 T (the 6-interrupt fallback) lose and
REM     double no frame;
REM   - END works (the runner needs the END marker).

#include "lib/bareout.bas"
#include <framehook.bas>

DIM hcnt, hcnt2 AS UINTEGER
DIM ifon, vs AS UBYTE
DIM sF AS ULONG
DIM sH AS UINTEGER
REM only touched from asm: read them so the compiler keeps them
IF hcnt = 1 AND hcnt2 = 1 AND ifon = 1 AND vs = 1 AND sH = 1 AND sF = 1 THEN
  BLine("unreachable")
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

REM Frames and the hook count, read together with interrupts off
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

REM About k x 0.32 s polling PPI port B bit 0, counting VSYNC rising edges in
REM vs (an independent count of frames); k <= 5
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

DIM bF, dF AS ULONG
DIM bH, dH AS UINTEGER
DIM i, j AS UINTEGER
DIM f0 AS ULONG
DIM refN AS LONG
DIM dp, m AS UINTEGER

SUB Begin()
  Snap()
  bF = sF
  bH = sH
END SUB

SUB Finish()
  Snap()
  dF = sF - bF
  dH = sH - bH
END SUB

REM the hook count equals the Frames() delta (16 bits)
SUB HookEq(name AS STRING)
  BCHK(name + "_hook_eq_frames", CAST(LONG, dH), CAST(LONG, dF bAND $FFFF))
END SUB

REM ---- first: Frames() at program start (only the boot has run) ----
f0 = Frames()
BRng("start_frames", CAST(LONG, f0), 0, 8)

hcnt = 0
FrameHook(@hkC)

REM ---- 50 a second, against the calibrated loop ----
Begin()
Busy(4)
Finish()
BRng("busy4_frames", CAST(LONG, dF), 69, 76)
HookEq("busy4")
Begin()
Busy(10)
Finish()
BRng("busy10_frames", CAST(LONG, dF), 174, 190)
HookEq("busy10")

REM ---- an independent count: VSYNC edges ----
Snap() : bF = sF
PollBusy(2)
Snap()
dF = sF - bF
BRng("vsync_edges_vs_frames", CAST(LONG, dF) - CAST(LONG, vs), -1, 1)
BRng("vsync_edges_ran", CAST(LONG, vs), 30, 40)

REM ---- the hook runs with interrupts off and may trash everything ----
hcnt = 0
ifon = 0
FrameHook(@hkT)
Begin()
Busy(3)
Finish()
HookEq("trash")
BRng("trash_hook_ran", CAST(LONG, dH), 50, 60)
BCHK("hook_ints_off", CAST(LONG, ifon), 0)

REM ---- FrameHookOff, and re-pointing ----
hcnt = 0
hcnt2 = 0
FrameHook(@hkC)
Busy(1)
Snap() : bH = sH : bF = sF
FrameHookOff()
Busy(1)
Snap()
BCHK("off_hook_stopped", CAST(LONG, sH), CAST(LONG, bH))
BRng("off_frames_go_on", CAST(LONG, sF - bF), 15, 20)
FrameHook(@hkC)
Busy(1)
Snap()
BRng("on_again", CAST(LONG, sH - bH), 15, 40)
Snap() : bH = sH : bF = sF
hcnt2 = 0
FrameHook(@hkD)
Busy(1)
FrameHookOff()
Snap()
BCHK("switch_old_stopped", CAST(LONG, sH), CAST(LONG, bH))
BRng("switch_new_runs", CAST(LONG, hcnt2), 15, 20)
BCHK("switch_new_eq_frames", CAST(LONG, hcnt2), CAST(LONG, (sF - bF) bAND $FFFF))

REM ---- DI sections of dp x 28 T (di0..di4 = 1960, 2800, 4004, 5600, 8400 T) ----
REM the hook still runs once a frame
REM Each run does the same loop with the section DI and with it EI (the
REM reference); frames counted by Frames(), time kept by the CPU.
hcnt = 0
FrameHook(@hkC)
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
  refN = CAST(LONG, dF)
  Begin()
  FOR i = 1 TO 7 * m
    DiBusy(dp)
    EiBusy(20)
  NEXT i
  Finish()
  HookEq("di" + CHR$(48 + j))
  BRng("di" + CHR$(48 + j) + "_vs_ref", CAST(LONG, dF) - refN, -3, 3)
NEXT j
FrameHookOff()

BDone()
