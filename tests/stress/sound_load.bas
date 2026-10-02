REM Interrupt load of the firmware sound manager on the CPC (Phase 5 sound).
REM   python3 tools/cpcrun.py tests/stress/sound_load.bas --timeout 120
REM (and --model 464). Not part of the conformance suite (about 40 s).
REM
REM The firmware's 300 Hz interrupt handler also runs the sound manager,
REM so queued notes cost CPU. A busy loop of known cost (28 T-states a
REM pass: DEC BC 8 + LD A,B 4 + OR C 4 + JP NZ 12, 7 us on the CPC; 20 x
REM 50000 passes = 1,000,000 passes = 7 s = 2100 ticks of the 300 Hz
REM clock, KL TIME PLEASE &BD0D) is timed with the clock:
REM   idle         nothing queued
REM   notes        three channels playing plain notes (no envelope)
REM   envelopes    three channels playing notes with a volume envelope
REM                that steps every 1/100 s (the manager's worst case
REM                here: every channel changes volume 100 times a second)
REM Load = 1 - 2100 / measured ticks.

#include <cpc.bas>

CONST NOMINAL AS ULONG = 2100

FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

REM Ticks taken by 20 x 50000 passes of the reference loop.
FUNCTION RefLoop() AS ULONG
  DIM t0, t1 AS ULONG
  t0 = Ticks()
  ASM
  ld d, 20
  RL_OUTER:
  ld bc, 50000
  RL_INNER:
  dec bc
  ld a, b
  or c
  jp nz, RL_INNER
  dec d
  jr nz, RL_OUTER
  END ASM
  t1 = Ticks()
  RETURN t1 - t0
END FUNCTION

SUB Report(name AS STRING, t AS ULONG)
  DIM pm AS ULONG
  pm = (t - NOMINAL) * 1000 / t
  PRINT "INFO "; name; " ticks="; t; " load="; pm / 10; "."; pm MOD 10; "%"
END SUB

DIM env(2) AS UBYTE = {100, 255, 1}
DIM r, ch, v, v0, n AS UBYTE
DIM t AS ULONG

SoundStop
Report("idle", RefLoop())
Report("idle", RefLoop())

r = SoundQueue(1, 200, 1500, 12, 0)
r = SoundQueue(2, 300, 1500, 12, 0)
r = SoundQueue(4, 400, 1500, 12, 0)
Report("notes", RefLoop())
SoundStop

SoundEnvelope 1, @env(0), 1
REM duration 65536 - 20: run the envelope (1 s) 20 times
r = SoundQueue(1, 200, 65516, 15, 1)
r = SoundQueue(2, 300, 65516, 15, 1)
r = SoundQueue(4, 400, 65516, 15, 1)
Report("envelopes", RefLoop())
REM still stepping after 7 s? (the volume changes within half a second)
t = Ticks()
n = 0
v0 = AyRead(8)
DO
  v = AyRead(8)
  IF v <> v0 THEN n = n + 1: v0 = v
LOOP UNTIL Ticks() - t > 150
PRINT "INFO volume changes in 0.5 s at the end: "; n
SoundStop
Report("idle_after", RefLoop())
PRINT "DONE"
