REM Stress/measurement: the interrupt load of a hooked song, normal mode
REM against game mode. Not part of the conformance suite (about 40 s of CPC
REM time); run it with
REM   python3 tools/cpcrun.py tests/stress/music_load.bas --emu chips --timeout 200
REM
REM A busy loop of 20 x 50000 passes of DEC BC / LD A,B / OR C / JP NZ (28
REM CPC T-states a pass: 28,000,000 T = 7.0 s = 350 frames = 2100 ticks of
REM the 300 Hz clock) runs with interrupts on; the elapsed time is read from
REM Frames() (the frame hook's counter, 50 Hz, runs in every mode) and, in
REM normal mode, from the firmware clock. Load = 1 - nominal / measured.

#include <cpc.bas>
#include <framehook.bas>
#include <music/music.bas>
#include "../conformance/assets/music/softhard.bas"

FUNCTION FASTCALL Ticks() AS ULONG
  ASM
  call .core.__FW_CALL
  defw $BD0D
  END ASM
END FUNCTION

SUB Busy()
  ASM
  ld e, 20
LOAD_OUTER:
  ld bc, 50000
LOAD_INNER:
  dec bc
  ld a, b
  or c
  jp nz, LOAD_INNER
  dec e
  jr nz, LOAD_OUTER
  END ASM
END SUB

SUB Measure(name AS STRING, normal AS UBYTE)
  DIM f0, f1, t0, t1 AS ULONG
  DIM fr AS ULONG
  DIM ld_ AS ULONG
  f0 = Frames()
  IF normal THEN t0 = Ticks()
  Busy()
  f1 = Frames()
  IF normal THEN t1 = Ticks()
  fr = f1 - f0
  REM load in 0.1 %: 1000 * (1 - 350 / fr)
  IF fr > 350 THEN ld_ = 1000 - 350000 / fr ELSE ld_ = 0
  PRINT "INFO "; name; ": frames="; fr; " load="; ld_ / 10; "."; ld_ MOD 10; " %";
  IF normal THEN
    IF t1 - t0 > 2100 THEN ld_ = 1000 - 2100000 / (t1 - t0) ELSE ld_ = 0
    PRINT "  ticks="; t1 - t0; " load="; ld_ / 10; "."; ld_ MOD 10; " %"
  ELSE
    PRINT
  END IF
END SUB

Measure("normal, no music", 1)
MusicInit(@softhard, 0)
Measure("normal, hooked softhard", 1)
MusicStop()
GameMode(1)
Measure("game, no music", 0)
MusicInit(@softhard, 0)
Measure("game, hooked softhard", 0)
MusicStop()
GameMode(0)
PRINT "DONE"
