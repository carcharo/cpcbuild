REM Tempo calibration for the Play library on the CPC (Phase 4d).
REM Not part of the conformance suite (it runs for about two minutes):
REM   python3 tools/cpcrun.py tests/stress/play_tempo.bas --timeout 300
REM (and --model 464).
REM
REM Play normally runs with interrupts off, so the firmware clock can't
REM time it. This program builds Play in its _PLAY_BENCHMARK_MODE (the
REM same code with interrupts left on, AY writes through the DI variant,
REM duration read from KL TIME PLEASE, &BD0D, the 300 Hz clock) and
REM corrects for the interrupt handler's share of the time by also timing
REM a reference loop of known CPC cost with interrupts on: the same
REM technique as the speed section of conformance/cb_sprites.bas. The
REM reference is a 28 T-state pass (DEC BC 8 + LD A,B 4 + OR C 4 + JP NZ 12;
REM the CPC rounds every instruction up to whole microseconds, so it is
REM 7 us) done 50000 times, REFREP times: exactly REFREP * 350 ms of CPU.
REM If the clock shows RT ticks for it, then every other measurement
REM taken the same way is (ticks * REFREP * 105 / RT) / 300 s of CPU time,
REM whatever fraction of the time the interrupts took.
REM
REM Each trial plays a string whose length is known in ticks of the Play
REM library (96 per bar; the loop runs one extra tick at the end, when the
REM channels find their strings finished) and prints the measured time,
REM the musical time (what a metronome would say) and the error against
REM both. The first is the quality of the overhead constants (the
REM compensation per tick and per processed channel in play.bas); the
REM second adds the extra last tick.

#define _PLAY_BENCHMARK_MODE
#include <play.bas>

CONST REFREP AS UBYTE = 10  REM (the asm below has the 10 in it)

DIM refTicks AS ULONG

FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

REM Ticks of the clock taken by REFREP * 50000 passes of the reference loop.
FUNCTION RefLoop() AS ULONG
  DIM t0, t1 AS ULONG
  t0 = Ticks()
  ASM
  ld d, 10                ; REFREP
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

REM Ticks taken by 20000 x (DI, LD A,8, LD C,0, [CALL the raw AY write],
REM EI) with interrupts on outside the DI window: with the call (On) and
REM without (Off: the loop, DI/EI and the two LDs alone).
FUNCTION WriteLoopOn() AS ULONG
  DIM t0, t1 AS ULONG
  t0 = Ticks()
  ASM
  ld hl, 20000
  WN_LOOP:
  di
  ld a, 8
  ld c, 0
  call .core.__CPC_AY_WRITE
  ei
  dec hl
  ld a, h
  or l
  jp nz, WN_LOOP
  END ASM
  t1 = Ticks()
  RETURN t1 - t0
END FUNCTION

FUNCTION WriteLoopOff() AS ULONG
  DIM t0, t1 AS ULONG
  t0 = Ticks()
  ASM
  ld hl, 20000
  WF_LOOP:
  di
  ld a, 8
  ld c, 0
  ei
  dec hl
  ld a, h
  or l
  jp nz, WF_LOOP
  END ASM
  t1 = Ticks()
  RETURN t1 - t0
END FUNCTION

DIM nTrial AS UBYTE
DIM trName(0 TO 15) AS STRING
DIM trPt(0 TO 15) AS ULONG
DIM trTicks(0 TO 15) AS UINTEGER
DIM trTempo(0 TO 15) AS UBYTE

REM Plays the three strings and records the clock ticks it took;
REM ticks = the musical length in Play ticks (96 per bar); tempo = the T
REM value used (for the expected duration). Printed by Report.
SUB Trial(name AS STRING, a$ AS STRING, b$ AS STRING, c$ AS STRING, ticks AS UINTEGER, tempo AS UBYTE)
  Play a$, b$, c$
  trName(nTrial) = name
  trPt(nTrial) = _Play_BenchTicks
  trTicks(nTrial) = ticks
  trTempo(nTrial) = tempo
  nTrial = nTrial + 1
END SUB

REM CPU time of Play = pt clock ticks * (CPU time of the reference /
REM clock ticks the reference took) = pt * (REFREP * 350 ms) / refTicks.
SUB Report()
  DIM i AS UBYTE
  DIM musMs, extMs, ms AS ULONG
  DIM e1, e2 AS LONG
  FOR i = 0 TO nTrial - 1
    REM a bar is 4 beats of 60000/tempo ms: 96 ticks = 240000/tempo ms
    musMs = CAST(ULONG, trTicks(i)) * 2500 / trTempo(i)
    extMs = CAST(ULONG, trTicks(i) + 1) * 2500 / trTempo(i)
    ms = trPt(i) * REFREP * 350 / refTicks
    e1 = (CAST(LONG, ms) - CAST(LONG, extMs)) * 10000 / CAST(LONG, extMs)
    e2 = (CAST(LONG, ms) - CAST(LONG, musMs)) * 10000 / CAST(LONG, musMs)
    PRINT "TRIAL "; trName(i); " ms="; ms; " musical="; musMs; " (+1 tick)="; extMs; " err_vs_loop(0.01%)="; e1; " err_vs_musical(0.01%)="; e2
  NEXT i
END SUB

REM The first pass of the reference after boot runs about 0.7 % faster
REM than the rest (fewer interrupt costs while the disc motor etc. settle):
REM it is run once and thrown away; the reference is then taken before and
REM after the trials and averaged.
DIM ref1, ref2 AS ULONG
PRINT "warm-up ref loop: "; RefLoop()
ref1 = RefLoop()
PRINT "ref loop 1: "; ref1; " ticks for "; CAST(ULONG, REFREP) * 350; " ms of CPU"

Trial("3ch crotchets T120", "T120 O4 5 CDEFGABc CDEFGABc CDEFGABc CDEFGABc", "O4 5 EFGABcde EFGABcde EFGABcde EFGABcde", "O3 5 GABcdefg GABcdefg GABcdefg GABcdefg", 768, 120)
Trial("3ch semiquavers T120", "T120 O4 1 CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc", "O4 1 EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde", "O3 1 GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg", 576, 120)
Trial("3ch semibreves T120", "T120 O4 9 CDEF CDEF", "O4 9 EFGA EFGA", "O3 9 GABc GABc", 768, 120)
Trial("3ch crotchets T240", "T240 O4 5 CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc CDEFGABc", "O4 5 EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde EFGABcde", "O3 5 GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg GABcdefg", 1536, 240)
Trial("1ch crotchets T120", "T120 O4 5 CDEFGABc CDEFGABc CDEFGABc CDEFGABc", "", "", 768, 120)
Trial("1ch minims T60", "T60 O4 7 CDEF CDEF", "", "", 384, 60)
Trial("3ch commands T120", "T120 V12 O4 5C&D&E V8 F O5 G a V12 O4 5C&D&E V8 F O5 G a V12 O4 5C&D&E V8 F O5 G a V12 O4 5C&D&E V8 F O5 G a", "V9 O3 5E&F&G O5 A O4 B c V9 O3 5E&F&G O5 A O4 B c V9 O3 5E&F&G O5 A O4 B c V9 O3 5E&F&G O5 A O4 B c", "V7 O2 5G A B & O4 c d e f V7 O2 5G A B & O4 c d e f V7 O2 5G A B & O4 c d e f V7 O2 5G A B & O4 c d e f", 768, 120)

DIM wOn, wOff AS ULONG
wOff = WriteLoopOff()
wOn = WriteLoopOn()
ref2 = RefLoop()
PRINT "ref loop 2: "; ref2
refTicks = (ref1 + ref2) / 2
PRINT "interrupt overhead (per 1000 of wall time): "; (refTicks - CAST(ULONG, REFREP) * 105) * 1000 / refTicks
REM CPU us per call = ticks * (REFREP * 350000 us / refTicks) / 20000
PRINT "AY write loop: with="; wOn; " without="; wOff; " ticks; __CPC_AY_WRITE + CALL + RET costs (ns): "; (wOn - wOff) * REFREP * 350000 / refTicks * 1000 / 20000
Report()
PRINT "DONE"
